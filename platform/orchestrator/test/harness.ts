/**
 * Test harness.
 *
 * Builds a full runtime on mocks with a controllable clock, and gives tests a
 * `drain()` that runs the saga runner to a fixed point. Because every WAIT
 * carries a retry delay, draining also advances the clock — otherwise a test
 * would sit forever on a step that is merely waiting.
 */

import { TestClock } from '../src/domain/clock.js';
import { money, type Money, type Quantity } from '../src/domain/money.js';
import { testConfig, type Config } from '../src/config/config.js';
import { bootstrap, type Runtime } from '../src/bootstrap.js';
import { MemoryStore } from '../src/adapters/store/memory.js';
import { MemoryLogger } from '../src/support/logger.js';
import type { Intent, IntentState } from '../src/orchestration/intent.js';

export interface Harness extends Runtime {
  readonly clock: TestClock;
  readonly logger: MemoryLogger;
  /** Run the runner until no intent advances, or `maxTicks` is reached. */
  drain(maxTicks?: number): Promise<void>;
  intent(id: string): Promise<Intent>;
  expectState(id: string, state: IntentState): Promise<Intent>;
}

export const WALLET = 'MarcoTestWa11et1111111111111111111111111111';
export const TICKER = '0700.HK';

export function usdc(amount: bigint): Money {
  return money('USDC', amount);
}

export function hkd(amount: bigint): Money {
  return money('HKD', amount);
}

export function shares(units: bigint, ticker = TICKER): Quantity {
  return { ticker, units };
}

export function createHarness(overrides: Partial<Config> = {}): Harness {
  const clock = new TestClock('2026-03-02T01:00:00.000Z');
  const logger = new MemoryLogger();
  const store = new MemoryStore(clock);
  const config = testConfig(overrides);
  const runtime = bootstrap({ config, clock, logger, store });

  const drain = async (maxTicks = 60): Promise<void> => {
    for (let i = 0; i < maxTicks; i += 1) {
      const result = await runtime.runner.tick();
      if (result.claimed === 0) {
        // Nothing was due. Advance past the shortest plausible wait and retry
        // once; if still nothing, the system has genuinely settled.
        clock.advance(30_000);
        const retry = await runtime.runner.tick();
        if (retry.claimed === 0) return;
        continue;
      }
      clock.advance(1_000);
    }
  };

  const intent = async (id: string): Promise<Intent> => {
    const found = await store.intents.get(id);
    if (!found) throw new Error(`Intent ${id} not found`);
    return found;
  };

  const expectState = async (id: string, state: IntentState): Promise<Intent> => {
    const found = await intent(id);
    if (found.state !== state) {
      throw new Error(
        `Expected intent ${id} to be ${state} but it is ${found.state}` +
          (found.manualReason ? ` — ${found.manualReason}` : '') +
          (found.lastError ? ` — ${found.lastError.message}` : '') +
          ` (stage: ${found.stage || 'none'})`,
      );
    }
    return found;
  };

  return { ...runtime, clock, logger, drain, intent, expectState };
}

/**
 * Seed a working system: an eligible verified trader, an active market, a
 * funded HKD buffer and a USDC float.
 */
export async function seedReadyToTrade(
  harness: Harness,
  options: { bufferHkd?: bigint; floatUsdc?: bigint; feeBps?: number } = {},
): Promise<void> {
  const { mocks, services } = harness;
  if (!mocks) throw new Error('Harness must be built on mock providers');

  mocks.chain.seedMarket({ ticker: TICKER, feeBps: options.feeBps ?? 50 });
  mocks.chain.seedTrader(WALLET, true);
  mocks.compliance.verify(WALLET, 'TIER_2');

  await services.store.accounts.create({
    wallet: WALLET,
    status: 'ACTIVE',
    verification: null,
    beneficiaryRefs: { default: 'BENEF-001' },
    suspendedReason: null,
  });

  // Fund the buffers directly. In production these arrive through a treasury
  // top-up; here we book the opening balance so the tests start from a known
  // position rather than replaying a funding cycle every time.
  const bufferHkd = options.bufferHkd ?? 5_000_000_00n;
  const floatUsdc = options.floatUsdc ?? 1_000_000_000_000n;

  await services.ledger.post({
    reference: 'test.seed_buffer',
    memo: 'Opening treasury balances for the test',
    cash: [
      { account: 'asset.broker.buffer', currency: 'HKD', amount: bufferHkd },
      { account: 'clearing.fx', currency: 'HKD', amount: -bufferHkd },
      { account: 'asset.treasury.usdc', currency: 'USDC', amount: floatUsdc },
      { account: 'clearing.fx', currency: 'USDC', amount: -floatUsdc },
    ],
  });

  mocks.broker.seedBuyingPower(hkd(bufferHkd));
}

/**
 * Seed an existing custodied position that is already tokenised on-chain, so a
 * sell test can start from a holder rather than replaying a whole buy.
 *
 * All three sources are set together — custodian, chain supply and ledger —
 * because a position that exists in only two of them is precisely what
 * reconciliation is supposed to flag.
 */
export async function seedPosition(
  harness: Harness,
  units: bigint,
  ticker = TICKER,
): Promise<void> {
  const { mocks, services } = harness;
  if (!mocks) throw new Error('Harness must be built on mock providers');

  mocks.custodian.seedPosition(ticker, units);
  mocks.chain.forceSupply(ticker, units);

  await services.ledger.post({
    reference: 'test.seed_position',
    memo: 'Opening custodied position for the test',
    positions: [
      { account: 'asset.custody.holdings', ticker, units },
      { account: 'liability.customer.positions', ticker, units: -units },
    ],
  });
}
