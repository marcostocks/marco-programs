/**
 * HTTP surface.
 *
 * Two distinct audiences, and they are kept apart deliberately:
 *
 *  - `/v1/**` is the **operator** API — bearer-authenticated, used by the admin
 *    console and by ops. It can read everything and can nudge the machine
 *    (retry, cancel, authorise a vault phase), but it cannot invent an intent.
 *    Intents are born from on-chain events only.
 *
 *  - `/v1/webhooks/**` is **counterparty** ingest — unauthenticated in the
 *    bearer sense, authenticated by HMAC over the raw body instead.
 *
 * Note what is absent: there is no "place an order" endpoint. The on-chain
 * escrow is the authorisation, so an HTTP caller has no way to make Marco spend
 * a trader's money.
 */

import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { describeError, OrchestratorError } from '../domain/errors.js';
import type { VaultPhase } from '../ports/chain.js';
import type { AssuranceTier, VerificationStatus } from '../ports/compliance.js';
import type { Services } from '../services.js';
import type { SagaRunner } from '../orchestration/runner.js';
import type { VaultDriver } from '../orchestration/vault-driver.js';
import { Reconciler } from '../recon/reconciler.js';
import { openBackingBreak, openCriticalBreaks } from '../recon/safety.js';
import { WebhookIngest, type WebhookSource } from './webhooks.js';
import {
  accountOut,
  assetOut,
  breakOut,
  bufferOut,
  holdingOut,
  intentOut,
  mandateOut,
  moneyOut,
  quantityOut,
  reservationOut,
  vaultPositionOut,
} from './serialize.js';

export interface ServerDeps {
  readonly services: Services;
  readonly runner: SagaRunner<Services>;
  readonly vaultDriver: VaultDriver;
}

/** Constant-time bearer comparison so a token cannot be discovered by timing. */
function tokenMatches(provided: string, allowed: readonly string[]): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  let matched = false;
  for (const candidate of allowed) {
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    if (
      providedBuffer.length === candidateBuffer.length &&
      timingSafeEqual(providedBuffer, candidateBuffer)
    ) {
      matched = true;
    }
  }
  return matched;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { services, runner, vaultDriver } = deps;
  const reconciler = new Reconciler(services);
  const ingest = new WebhookIngest(services);

  const app = Fastify({
    logger: false,
    // Counterparty payloads are small; a large body on this surface is a
    // mistake or an attack, not a legitimate notification.
    bodyLimit: 1024 * 512,
  });

  /**
   * Keep the raw bytes. Signature verification must run over exactly what was
   * received — re-serialising parsed JSON reorders keys and breaks the HMAC.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      (request as FastifyRequest & { rawBody?: Buffer }).rawBody = body as Buffer;
      if ((body as Buffer).length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse((body as Buffer).toString('utf8')));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof OrchestratorError) {
      const status =
        error.code === 'not_found'
          ? 404
          : error.code === 'validation_failed'
            ? 400
            : error.code === 'webhook_verification_failed'
              ? 401
              : error.code === 'conflict' || error.code === 'illegal_transition'
                ? 409
                : 500;
      return reply.status(status).send({ error: error.toJSON() });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: { code: 'validation_failed', message: 'Invalid request body', issues: error.issues },
      });
    }
    services.logger.error({ error: describeError(error) }, 'Unhandled API error');
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  /* ---- Health ---------------------------------------------------------- */

  app.get('/healthz', async () => ({ status: 'ok', at: services.clock.nowIso() }));

  /**
   * Readiness is not liveness. The process being up says nothing about whether
   * it can safely orchestrate money, so this reports buffer health and open
   * critical breaks and fails closed on either.
   */
  app.get('/readyz', async (_request, reply) => {
    const { snapshots } = await services.treasury.assessAll();
    // Acknowledged-but-unresolved still counts: acknowledging a shortfall does
    // not put the shares back.
    const criticalBreaks = await openCriticalBreaks(services.store);

    const ready = snapshots.every((snapshot) => snapshot.healthy) && criticalBreaks.length === 0;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      buffers: snapshots.map(bufferOut),
      openCriticalBreaks: criticalBreaks.length,
    });
  });

  /* ---- Operator auth --------------------------------------------------- */

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/v1/')) return;
    if (request.url.startsWith('/v1/webhooks/')) return;

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token || !tokenMatches(token, services.config.operatorTokens)) {
      return reply.status(401).send({ error: { code: 'unauthorized', message: 'Invalid or missing bearer token' } });
    }
  });

  /* ---- Intents --------------------------------------------------------- */

  const intentQuery = z.object({
    wallet: z.string().optional(),
    kind: z.enum(['SPOT_BUY', 'SPOT_SELL', 'VAULT_SUBSCRIBE', 'VAULT_REDEEM', 'VAULT_DELIVERY']).optional(),
    state: z.enum(['PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'UNWINDING', 'CANCELLED', 'NEEDS_MANUAL']).optional(),
    ticker: z.string().optional(),
    vaultId: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).default(100),
  });

  app.get('/v1/intents', async (request) => {
    const query = intentQuery.parse(request.query);
    const intents = await services.store.intents.list(query);
    return { intents: intents.map(intentOut), count: intents.length };
  });

  app.get('/v1/intents/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const intent = await services.store.intents.get(id);
    if (!intent) return reply.status(404).send({ error: { code: 'not_found', message: `Intent ${id} not found` } });

    const attempts = await services.store.attempts.listForIntent(id);
    const entries = await services.ledger.entries({ intentId: id });

    return {
      intent: intentOut(intent),
      attempts,
      journal: entries.map((entry) => ({
        id: entry.id,
        at: entry.at,
        reference: entry.reference,
        memo: entry.memo,
        cash: entry.cash.map((posting) => ({
          account: posting.account,
          currency: posting.currency,
          amount: posting.amount.toString(),
        })),
        positions: entry.positions.map((posting) => ({
          account: posting.account,
          ticker: posting.ticker,
          units: posting.units.toString(),
        })),
      })),
    };
  });

  /**
   * Resume a parked intent.
   *
   * Requires an explicit note. NEEDS_MANUAL means a human had to look at
   * something, and "why is it safe to continue" belongs in the audit trail.
   */
  app.post('/v1/intents/:id/resume', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { note } = z.object({ note: z.string().min(1) }).parse(request.body);

    const intent = await services.store.intents.get(id);
    if (!intent) return reply.status(404).send({ error: { code: 'not_found', message: `Intent ${id} not found` } });
    if (intent.state !== 'NEEDS_MANUAL') {
      return reply.status(409).send({
        error: { code: 'conflict', message: `Intent is ${intent.state}, not NEEDS_MANUAL` },
      });
    }

    const resumed = await services.store.intents.save(
      {
        ...intent,
        state: 'RUNNING',
        manualReason: null,
        attempts: {},
        nextAttemptAt: services.clock.nowIso(),
      },
      intent.version,
    );
    services.logger.warn({ intentId: id, note }, 'Operator resumed a parked intent');
    return { intent: intentOut(resumed) };
  });

  /** Force an intent into its unwind path. */
  app.post('/v1/intents/:id/unwind', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { note } = z.object({ note: z.string().min(1) }).parse(request.body);

    const intent = await services.store.intents.get(id);
    if (!intent) return reply.status(404).send({ error: { code: 'not_found', message: `Intent ${id} not found` } });

    const updated = await services.store.intents.save(
      { ...intent, state: 'UNWINDING', manualReason: note, nextAttemptAt: services.clock.nowIso() },
      intent.version,
    );
    services.logger.warn({ intentId: id, note }, 'Operator forced an unwind');
    return { intent: intentOut(updated) };
  });

  /** Drive the runner once, for operators who do not want to wait for the loop. */
  app.post('/v1/intents/tick', async () => ({ result: await runner.tick() }));

  /* ---- Accounts -------------------------------------------------------- */

  app.get('/v1/accounts/:wallet', async (request, reply) => {
    const { wallet } = z.object({ wallet: z.string() }).parse(request.params);
    const account = await services.store.accounts.get(wallet);
    if (!account) {
      return reply.status(404).send({ error: { code: 'not_found', message: `No account for ${wallet}` } });
    }
    return { account: accountOut(account) };
  });

  app.post('/v1/accounts', async (request) => {
    const body = z
      .object({
        wallet: z.string().min(32),
        beneficiaryRefs: z.record(z.string()).default({}),
      })
      .parse(request.body);

    const existing = await services.store.accounts.get(body.wallet);
    if (existing) return { account: accountOut(existing), created: false };

    const account = await services.store.accounts.create({
      wallet: body.wallet,
      status: 'ACTIVE',
      verification: null,
      beneficiaryRefs: body.beneficiaryRefs,
      suspendedReason: null,
    });
    return { account: accountOut(account), created: true };
  });

  /**
   * Record a verification decision from the KYC provider.
   *
   * The orchestrator stores the *outcome*, never the underlying documents or
   * identity data. Those stay with the provider that is licensed to hold them.
   */
  app.put('/v1/accounts/:wallet/verification', async (request, reply) => {
    const { wallet } = z.object({ wallet: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['NONE', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED']),
        tier: z.enum(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']),
        subjectRef: z.string().min(1),
        jurisdiction: z.string().min(2),
        professionalInvestor: z.boolean().default(false),
        expiresAt: z.string().datetime().nullable().default(null),
      })
      .parse(request.body);

    const account = await services.store.accounts.get(wallet);
    if (!account) {
      return reply.status(404).send({ error: { code: 'not_found', message: `No account for ${wallet}` } });
    }

    const verification = {
      wallet,
      status: body.status as VerificationStatus,
      tier: body.tier as AssuranceTier,
      subjectRef: body.subjectRef,
      jurisdiction: body.jurisdiction,
      professionalInvestor: body.professionalInvestor,
      verifiedAt: body.status === 'VERIFIED' ? services.clock.nowIso() : null,
      expiresAt: body.expiresAt,
    };

    await services.compliance.upsertVerification(verification);
    const saved = await services.store.accounts.save({ ...account, verification }, account.version);
    return { account: accountOut(saved) };
  });

  /* ---- Vault mandates -------------------------------------------------- */

  app.get('/v1/vaults', async () => {
    const mandates = await services.store.mandates.list({});
    return { mandates: mandates.map(mandateOut), count: mandates.length };
  });

  app.get('/v1/vaults/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const mandate = await services.store.mandates.get(id);
    if (!mandate) {
      return reply.status(404).send({ error: { code: 'not_found', message: `No mandate ${id}` } });
    }
    const onChain = await services.chain.getVault(mandate.vaultId);
    return {
      mandate: mandateOut(mandate),
      onChain: onChain
        ? {
            phase: onChain.phase,
            totalDeposits: moneyOut(onChain.totalDeposits),
            totalShares: onChain.totalShares.toString(),
            usdcBalance: moneyOut(onChain.usdcBalance),
            feesEscrowed: moneyOut(onChain.feesEscrowed),
            feesCollected: moneyOut(onChain.feesCollected),
            redeemableAmount: moneyOut(onChain.redeemableAmount),
            electionDeadline: onChain.electionDeadline,
          }
        : null,
    };
  });

  app.post('/v1/vaults', async (request) => {
    const body = z
      .object({
        vaultId: z.string().min(1),
        listingId: z.string().min(1),
        companyName: z.string().min(1),
        electionPeriodSeconds: z.number().int().nonnegative().default(0),
        brokerAccountRef: z.string().default(services.config.accounts.brokerRef),
        custodyAccountRef: z.string().default(services.config.accounts.custodyRef),
      })
      .parse(request.body);

    const mandate = await vaultDriver.createMandate(body);
    return { mandate: mandateOut(mandate) };
  });

  /**
   * Authorise the next phase advance.
   *
   * Two-step by design: authorising is separate from executing. The driver
   * still refuses to submit until the off-chain fact that justifies the phase
   * actually exists, so this is permission, not a command.
   */
  app.post('/v1/vaults/:id/advance', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { phase } = z
      .object({
        phase: z.enum([
          'Funding', 'Sealed', 'Sourcing', 'Sourced', 'Deployed', 'Live',
          'Realized', 'Claimable', 'Winding', 'Concluded', 'Cancelled',
        ]),
      })
      .parse(request.body);

    const mandate = await vaultDriver.requestPhase(id, phase as VaultPhase);
    const result = await vaultDriver.tick(id);
    return { mandate: mandateOut(mandate), result };
  });

  /* ---- Markets --------------------------------------------------------- */

  app.get('/v1/markets/:ticker', async (request, reply) => {
    const { ticker } = z.object({ ticker: z.string() }).parse(request.params);
    const market = await services.chain.getMarket(ticker);
    if (!market) {
      return reply.status(404).send({ error: { code: 'not_found', message: `No market for ${ticker}` } });
    }

    const shortfall = await openBackingBreak(services.store, ticker);
    return {
      market: {
        ticker: market.ticker,
        status: market.status,
        positionSupply: quantityOut(market.positionSupply),
        escrowBalance: moneyOut(market.escrowBalance),
        feeBps: market.feeBps,
        feesCollected: moneyOut(market.feesCollected),
        feesSwept: moneyOut(market.feesSwept),
      },
      backingShortfall: shortfall ? breakOut(shortfall) : null,
    };
  });

  /**
   * Halt or resume a market.
   *
   * Deliberately a human action. A backing shortfall already blocks minting on
   * its own, so nothing unbacked can be created while an operator decides — and
   * that means a custodian reporting glitch can never halt a live market
   * unattended.
   *
   * The on-chain program handles a halt gracefully: no new orders, but in-flight
   * orders still settle or cancel, so halting never strands capital that has
   * already left a wallet.
   */
  app.post('/v1/markets/:ticker/status', async (request) => {
    const { ticker } = z.object({ ticker: z.string() }).parse(request.params);
    const { status, note } = z
      .object({
        status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']),
        note: z.string().min(1),
      })
      .parse(request.body);

    const result = await services.chain.setMarketStatus(ticker, status);
    services.logger.warn(
      { ticker, status, note, signature: result.signature },
      'Operator changed market status',
    );
    return { ticker, status, note, signature: result.signature, alreadyApplied: result.alreadyApplied };
  });

  /* ---- Treasury -------------------------------------------------------- */

  /* ---- Distribution ---------------------------------------------------- */

  /**
   * Everything a distributor can offer, in one list.
   *
   * Read from chain rather than from a registry: the programs are the only
   * authority on what exists, and a cached list is a list that will eventually
   * be wrong about a paused market.
   *
   * NOTE: these sit behind the same operator bearer token as the rest of /v1.
   * Per-partner keys and scopes are still to come; until then, do not hand this
   * token to a partner — it also opens the vault and treasury routes.
   */
  app.get('/v1/assets', async (request) => {
    const query = z
      .object({
        kind: z.enum(['SPOT', 'VAULT']).optional(),
        // Not z.coerce.boolean(): it maps the string "false" to true.
        tradeable: z.enum(['true', 'false']).optional(),
      })
      .parse(request.query);

    const [markets, vaults] = await Promise.all([
      query.kind === 'VAULT' ? Promise.resolve([]) : services.chain.listMarkets(),
      query.kind === 'SPOT' ? Promise.resolve([]) : services.chain.listVaults(),
    ]);

    let assets = [...markets, ...vaults].map(assetOut) as Array<{ tradeable: boolean }>;
    if (query.tradeable !== undefined) {
      const want = query.tradeable === 'true';
      assets = assets.filter((asset) => asset.tradeable === want);
    }
    return { assets, count: assets.length };
  });

  /**
   * One wallet's positions across every asset.
   *
   * Cost basis and realised proceeds come from the programs' own `Holding` and
   * `BuyerState` accounts, not from a balance read: a token balance says what is
   * held now and nothing about what it cost. A wallet that never touched an
   * asset has no account for it, which is why absent means omitted rather than
   * zero.
   */
  app.get('/v1/positions', async (request) => {
    const query = z
      .object({
        wallet: z.string().min(32),
        assetId: z.string().optional(),
        open: z.enum(['true', 'false']).optional(),
      })
      .parse(request.query);

    const [markets, vaults] = await Promise.all([
      services.chain.listMarkets(),
      services.chain.listVaults(),
    ]);

    const tickers = markets
      .map((market) => market.ticker)
      .filter((ticker) => !query.assetId || ticker === query.assetId);
    const vaultIds = vaults
      .map((vault) => vault.vaultId)
      .filter((vaultId) => !query.assetId || vaultId === query.assetId);

    const [holdings, vaultPositions] = await Promise.all([
      Promise.all(tickers.map((ticker) => services.chain.getHolding(ticker, query.wallet))),
      Promise.all(vaultIds.map((vaultId) => services.chain.getVaultPosition(vaultId, query.wallet))),
    ]);

    const onlyOpen = query.open === 'true';
    const spot = holdings
      .filter((holding) => holding !== null)
      .filter((holding) => !onlyOpen || holding.openQuantity.units > 0n)
      .map(holdingOut);
    const vaulted = vaultPositions
      .filter((position) => position !== null)
      .filter((position) => !onlyOpen || position.openShares > 0n)
      .map(vaultPositionOut);

    return {
      wallet: query.wallet,
      positions: [...spot, ...vaulted],
      count: spot.length + vaulted.length,
    };
  });

  app.get('/v1/treasury', async () => {
    const { snapshots, plans } = await services.treasury.assessAll();
    return {
      buffers: snapshots.map(bufferOut),
      topUpPlans: plans.map((plan) => ({
        currency: plan.currency,
        amount: moneyOut(plan.amount),
        reason: plan.reason,
      })),
    };
  });

  app.get('/v1/treasury/reservations', async (request) => {
    const { currency } = z
      .object({ currency: z.enum(['USDC', 'USDT', 'USD', 'HKD', 'CNH']).default('HKD') })
      .parse(request.query);
    const held = await services.store.reservations.listHeld(currency);
    return { reservations: held.map(reservationOut), count: held.length };
  });

  app.post('/v1/treasury/sweep-expired', async () => {
    const swept = await services.treasury.sweepExpired();
    return { swept: swept.map(reservationOut), count: swept.length };
  });

  /* ---- Ledger ---------------------------------------------------------- */

  app.get('/v1/ledger/trial-balance', async () => {
    const trial = services.ledger.trialBalance();
    return {
      trial,
      balanced:
        Object.values(trial.cash).every((total) => total === '0') &&
        Object.values(trial.positions).every((total) => total === '0'),
    };
  });

  app.get('/v1/ledger/balances', async (request) => {
    const { currency } = z
      .object({ currency: z.enum(['USDC', 'USDT', 'USD', 'HKD', 'CNH']).default('USDC') })
      .parse(request.query);
    return {
      currency,
      accounts: services.ledger
        .balancesByCurrency(currency)
        .map((row) => ({ account: row.account, amount: row.amount.toString() })),
    };
  });

  /* ---- Reconciliation -------------------------------------------------- */

  app.post('/v1/recon/run', async (request) => {
    const body = z
      .object({
        tickers: z.array(z.string()).default([]),
        vaultIds: z.array(z.string()).default([]),
      })
      .parse(request.body ?? {});

    const run = await reconciler.run(body);
    return {
      runId: run.runId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      clean: run.clean,
      breaks: run.breaks.map(breakOut),
    };
  });

  app.get('/v1/recon/breaks', async (request) => {
    const { status, severity } = z
      .object({
        status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
        severity: z.enum(['INFO', 'WARN', 'CRITICAL']).optional(),
      })
      .parse(request.query);
    const items = await services.store.breaks.list({ status, severity });
    return { breaks: items.map(breakOut), count: items.length };
  });

  app.post('/v1/recon/breaks/:id/resolve', async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { resolution } = z.object({ resolution: z.string().min(1) }).parse(request.body);
    const resolved = await reconciler.resolveBreak(id, resolution);
    return { break: breakOut(resolved) };
  });

  /* ---- Webhooks -------------------------------------------------------- */

  for (const source of ['msb', 'broker', 'custodian'] as const) {
    app.post(`/v1/webhooks/${source}`, async (request, reply) => {
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        return reply.status(400).send({
          error: { code: 'validation_failed', message: 'Missing request body' },
        });
      }

      const result = await ingest.ingest(source as WebhookSource, {
        body: rawBody,
        headers: request.headers,
        receivedAt: services.clock.nowIso(),
      });
      return result;
    });
  }

  return app;
}
