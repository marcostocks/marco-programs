/**
 * Entrypoint.
 *
 * Runs three loops alongside the HTTP server:
 *
 *   watcher  — turns on-chain events into intents
 *   runner   — drives intents through their sagas
 *   vaults   — advances authorised vault phases
 *
 * All three are idempotent and cursor- or lease-based, so running two instances
 * is safe and a restart resumes rather than replays.
 */

import { buildServer } from './api/server.js';
import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config/config.js';
import { describeError } from './domain/errors.js';
import { ConsoleLogger } from './support/logger.js';

async function start(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger(config.logLevel, { service: 'marco-orchestrator' });
  const runtime = bootstrap({ config, logger });

  await runtime.services.ledger.load();

  const app = await buildServer({
    services: runtime.services,
    runner: runtime.runner,
    vaultDriver: runtime.vaultDriver,
  });

  let stopping = false;
  const timers: NodeJS.Timeout[] = [];

  /**
   * Each loop is self-scheduling rather than on a fixed interval, so a slow
   * tick cannot pile up concurrent runs against the same leases.
   */
  const loop = (name: string, intervalMs: number, tick: () => Promise<unknown>): void => {
    const schedule = (): void => {
      if (stopping) return;
      const timer = setTimeout(async () => {
        try {
          await tick();
        } catch (error) {
          logger.error({ loop: name, error: describeError(error) }, 'Loop iteration failed');
        } finally {
          schedule();
        }
      }, intervalMs);
      timer.unref();
      timers.push(timer);
    };
    schedule();
  };

  loop('watcher', config.runner.baseBackoffMillis * 2, () => runtime.watcher.poll());
  loop('runner', 1000, () => runtime.runner.tick());
  loop('vaults', 30_000, () => runtime.vaultDriver.tickAll());
  loop('reservation-sweeper', 60_000, async () => {
    const swept = await runtime.services.treasury.sweepExpired();
    if (swept.length > 0) {
      logger.warn(
        { count: swept.length, reservationIds: swept.map((r) => r.id) },
        'Swept expired treasury reservations — the owning intents stalled',
      );
    }
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ port: config.port, env: config.env }, 'Marco orchestrator listening');

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down');
    for (const timer of timers) clearTimeout(timer);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((error) => {
  process.stderr.write(`${JSON.stringify(describeError(error))}\n`);
  process.exit(1);
});
