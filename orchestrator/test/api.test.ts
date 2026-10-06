import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';
import { createHarness, hkd, seedReadyToTrade, shares, TICKER, usdc, WALLET, type Harness } from './harness.js';

const AUTH = { authorization: 'Bearer test-token' };

describe('HTTP API', () => {
  let harness: Harness;
  let app: FastifyInstance;

  beforeEach(async () => {
    harness = createHarness();
    await seedReadyToTrade(harness);
    app = await buildServer({
      services: harness.services,
      runner: harness.runner,
      vaultDriver: harness.vaultDriver,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('auth', () => {
    it('rejects an operator call with no token', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/intents' });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a wrong token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/intents',
        headers: { authorization: 'Bearer nope' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('accepts a valid token', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/intents', headers: AUTH });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ count: 0 });
    });

    it('leaves health checks open', async () => {
      expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    });
  });

  describe('surface', () => {
    it('offers no way to create an order over HTTP', async () => {
      // The on-chain escrow is the authorisation. If this route existed, an
      // HTTP caller could make Marco spend a trader's money.
      const routes = app.printRoutes();
      expect(routes).not.toMatch(/orders/);
      const response = await app.inject({
        method: 'POST',
        url: '/v1/intents',
        headers: AUTH,
        payload: { kind: 'SPOT_BUY', wallet: WALLET },
      });
      expect(response.statusCode).toBe(404);
    });

    it('serialises amounts without losing precision', async () => {
      harness.mocks!.chain.placeBuy({
        orderId: 'ord-1',
        ticker: TICKER,
        trader: WALLET,
        amount: usdc(123_456_789_012_345n),
        limitPrice: hkd(365_40n),
        quantity: shares(200n),
      });
      await harness.watcher.poll();

      const response = await app.inject({ method: 'GET', url: '/v1/intents', headers: AUTH });
      const body = response.json();
      // A bigint through JSON.stringify would have thrown; a Number would have
      // silently rounded. Neither is acceptable for a balance.
      expect(body.intents[0].request.amount.minorUnits).toBe('123456789012345');
      expect(body.intents[0].request.amount.decimal).toBe('123456789.012345');
    });

    it('reports the trial balance', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/ledger/trial-balance',
        headers: AUTH,
      });
      expect(response.json().balanced).toBe(true);
    });

    it('requires a note to resume a parked intent', async () => {
      const now = harness.clock.nowIso();
      await harness.services.store.intents.create({
        id: 'int_parked',
        kind: 'SPOT_BUY',
        state: 'NEEDS_MANUAL',
        stage: 'await_custody',
        wallet: WALLET,
        source: { signature: 's', slot: 1, observedAt: now },
        request: {},
        facts: {},
        attempts: {},
        lastError: null,
        nextAttemptAt: null,
        manualReason: 'needs a look',
        createdAt: now,
        updatedAt: now,
        version: 1,
      });

      const noNote = await app.inject({
        method: 'POST',
        url: '/v1/intents/int_parked/resume',
        headers: AUTH,
        payload: {},
      });
      expect(noNote.statusCode).toBe(400);

      const withNote = await app.inject({
        method: 'POST',
        url: '/v1/intents/int_parked/resume',
        headers: AUTH,
        payload: { note: 'Custodian confirmed the reference by phone, ticket OPS-91' },
      });
      expect(withNote.statusCode).toBe(200);
      expect(withNote.json().intent.state).toBe('RUNNING');
    });
  });

  describe('webhook ingest', () => {
    const signedNow = () => Math.floor(harness.clock.nowMillis() / 1000);

    it('accepts a correctly signed delivery', async () => {
      const raw = harness.mocks!.msb.signWebhook(
        { id: 'dlv_1', type: 'conversion.settled', clientRef: 'int_x.fund_execution' },
        signedNow(),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/msb',
        headers: { ...(raw.headers as Record<string, string>), 'content-type': 'application/json' },
        payload: raw.body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ accepted: 1, duplicates: 0 });
    });

    it('rejects a tampered body', async () => {
      const raw = harness.mocks!.msb.signWebhook(
        { id: 'dlv_2', type: 'conversion.settled' },
        signedNow(),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/msb',
        headers: { ...(raw.headers as Record<string, string>), 'content-type': 'application/json' },
        // Same signature, different body.
        payload: Buffer.from(JSON.stringify({ id: 'dlv_2', type: 'conversion.failed' })),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('webhook_verification_failed');
    });

    it('rejects a missing signature outright', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/msb',
        headers: { 'content-type': 'application/json' },
        payload: Buffer.from(JSON.stringify({ id: 'dlv_3' })),
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a replayed delivery outside the tolerance window', async () => {
      const raw = harness.mocks!.msb.signWebhook({ id: 'dlv_4' }, signedNow());

      // The capture is valid now...
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/webhooks/msb',
            headers: { ...(raw.headers as Record<string, string>), 'content-type': 'application/json' },
            payload: raw.body,
          })
        ).statusCode,
      ).toBe(200);

      // ...and worthless an hour later, even though the signature still checks.
      harness.clock.advanceSeconds(3600);
      const replayed = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/msb',
        headers: { ...(raw.headers as Record<string, string>), 'content-type': 'application/json' },
        payload: raw.body,
      });
      expect(replayed.statusCode).toBe(401);
      expect(replayed.json().error.message).toMatch(/replay window/);
    });

    it('drops a redelivery of the same event', async () => {
      const raw = harness.mocks!.broker.signWebhook(
        { id: 'dlv_5', type: 'order.filled', clientOrderId: 'int_x.place_order' },
        signedNow(),
      );

      const send = () =>
        app.inject({
          method: 'POST',
          url: '/v1/webhooks/broker',
          headers: { ...(raw.headers as Record<string, string>), 'content-type': 'application/json' },
          payload: raw.body,
        });

      expect((await send()).json()).toMatchObject({ accepted: 1, duplicates: 0 });
      // Counterparties retry aggressively. Applying a fill twice would double
      // the position.
      expect((await send()).json()).toMatchObject({ accepted: 0, duplicates: 1 });
    });

    it('wakes the owning intent rather than mutating money itself', async () => {
      harness.mocks!.chain.placeBuy({
        orderId: 'ord-1',
        ticker: TICKER,
        trader: WALLET,
        amount: usdc(10_000_000_000n),
        limitPrice: hkd(365_40n),
        quantity: shares(200n),
      });
      await harness.watcher.poll();
      const [intent] = await harness.services.store.intents.list({ kind: 'SPOT_BUY' });
      await harness.drain();

      const waiting = await harness.intent(intent!.id);
      expect(waiting.state).toBe('WAITING');
      // Push it well into the future so "woken" means something observable.
      await harness.services.store.intents.save(
        { ...waiting, nextAttemptAt: new Date(harness.clock.nowMillis() + 3_600_000).toISOString() },
        waiting.version,
      );

      const raw = harness.mocks!.broker.signWebhook(
        {
          id: 'dlv_6',
          type: 'order.filled',
          clientOrderId: `${intent!.id}.place_order`,
        },
        signedNow(),
      );
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/broker',
        headers: { ...(raw.headers as Record<string, string>), 'content-type': 'application/json' },
        payload: raw.body,
      });

      expect(response.json().woken).toContain(intent!.id);
      const after = await harness.intent(intent!.id);
      // It is due immediately rather than an hour out.
      expect(after.nextAttemptAt!).toBe(harness.clock.nowIso());
      // The webhook is a hint, not a statement of fact: nothing was booked.
      expect(after.facts.filledQuantity).toBeUndefined();
    });

    it('does not wake an intent that is parked for a human', async () => {
      const now = harness.clock.nowIso();
      await harness.services.store.intents.create({
        id: 'int_parked2',
        kind: 'SPOT_BUY',
        state: 'NEEDS_MANUAL',
        stage: 'place_order',
        wallet: WALLET,
        source: { signature: 's2', slot: 1, observedAt: now },
        request: {},
        facts: {},
        attempts: {},
        lastError: null,
        nextAttemptAt: null,
        manualReason: 'compliance review',
        createdAt: now,
        updatedAt: now,
        version: 1,
      });

      const raw = harness.mocks!.broker.signWebhook(
        { id: 'dlv_7', type: 'order.filled', clientOrderId: 'int_parked2.place_order' },
        signedNow(),
      );
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/broker',
        headers: { ...(raw.headers as Record<string, string>), 'content-type': 'application/json' },
        payload: raw.body,
      });

      expect(response.json().woken).toEqual([]);
      expect((await harness.intent('int_parked2')).state).toBe('NEEDS_MANUAL');
    });
  });
});
