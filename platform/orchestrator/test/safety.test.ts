/**
 * The interlock between reconciliation and the mint path.
 *
 * Detecting a backing shortfall and then continuing to mint is not a control.
 * These tests pin the behaviour that makes it one.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/api/server.js';
import { Reconciler } from '../src/recon/reconciler.js';
import {
  createHarness,
  hkd,
  seedPosition,
  seedReadyToTrade,
  shares,
  TICKER,
  usdc,
  WALLET,
  type Harness,
} from './harness.js';

const ESCROW = usdc(10_000_000_000n);
const LIMIT = hkd(365_40n);

/** Drive a buy to the point where the next step would mint. */
async function buyReadyToMint(harness: Harness, orderId: string): Promise<string> {
  const { mocks } = harness;

  mocks!.chain.placeBuy({
    orderId,
    ticker: TICKER,
    trader: WALLET,
    amount: ESCROW,
    limitPrice: LIMIT,
    quantity: shares(200n),
  });
  await harness.watcher.poll();
  const intents = await harness.services.store.intents.list({ kind: 'SPOT_BUY' });
  const id = intents[intents.length - 1]!.id;

  await harness.drain();
  let intent = await harness.intent(id);

  await mocks!.broker.fill(intent.facts.brokerClientOrderId!, intent.facts.plannedQuantity!.units, LIMIT);
  await harness.drain();

  intent = await harness.intent(id);
  await mocks!.msb.settleConversion(intent.facts.conversionRef!);
  await harness.drain();
  intent = await harness.intent(id);
  await mocks!.msb.settlePayout(intent.facts.payoutRef!);
  await harness.drain();

  intent = await harness.intent(id);
  const tradeRef = intent.facts.brokerTradeReference!;
  await mocks!.custodian.acknowledgeTrade(
    tradeRef,
    TICKER,
    intent.facts.filledQuantity!,
    intent.facts.grossConsideration!,
  );
  await mocks!.custodian.settle(tradeRef);

  return id;
}

describe('backing shortfall interlock', () => {
  let harness: Harness;
  let reconciler: Reconciler;

  beforeEach(async () => {
    harness = createHarness();
    await seedReadyToTrade(harness);
    reconciler = new Reconciler(harness.services);
  });

  it('mints normally when reconciliation is clean', async () => {
    const id = await buyReadyToMint(harness, 'ord-clean');
    await harness.drain();

    await harness.expectState(id, 'COMPLETED');
    expect((await harness.mocks!.chain.getMarket(TICKER))!.positionSupply.units).toBe(200n);
  });

  it('refuses to mint into an open backing shortfall', async () => {
    const id = await buyReadyToMint(harness, 'ord-blocked');

    // The custodian is short before the mint lands.
    harness.mocks!.custodian.forcePosition(TICKER, 10n);
    harness.mocks!.chain.forceSupply(TICKER, 500n);
    const run = await reconciler.run({ tickers: [TICKER] });
    expect(run.breaks.some((b) => b.scope === `positions:${TICKER}:backing`)).toBe(true);

    await harness.drain();

    const parked = await harness.expectState(id, 'NEEDS_MANUAL');
    expect(parked.manualReason).toMatch(/blocked by an unresolved backing shortfall/);
    expect(parked.manualReason).toMatch(/BACKING SHORTFALL/);

    // Crucially: no new tokens were created on top of the shortfall.
    expect((await harness.mocks!.chain.getMarket(TICKER))!.positionSupply.units).toBe(500n);
  });

  it('stays blocked while the break is merely acknowledged', async () => {
    const id = await buyReadyToMint(harness, 'ord-ack');
    harness.mocks!.custodian.forcePosition(TICKER, 10n);
    harness.mocks!.chain.forceSupply(TICKER, 500n);
    const run = await reconciler.run({ tickers: [TICKER] });
    const item = run.breaks.find((b) => b.scope === `positions:${TICKER}:backing`)!;

    // Acknowledging a shortfall does not put the shares back.
    await harness.services.store.breaks.save({ ...item, status: 'ACKNOWLEDGED' }, item.version);

    await harness.drain();
    await harness.expectState(id, 'NEEDS_MANUAL');
  });

  it('mints once the break is resolved and the intent is resumed', async () => {
    const id = await buyReadyToMint(harness, 'ord-resolve');
    harness.mocks!.custodian.forcePosition(TICKER, 10n);
    harness.mocks!.chain.forceSupply(TICKER, 500n);
    const run = await reconciler.run({ tickers: [TICKER] });
    const item = run.breaks.find((b) => b.scope === `positions:${TICKER}:backing`)!;

    await harness.drain();
    await harness.expectState(id, 'NEEDS_MANUAL');

    // Custody is restored and the break is closed with a written explanation.
    harness.mocks!.custodian.forcePosition(TICKER, 700n);
    await reconciler.resolveBreak(item.id, 'Custodian mis-booked a transfer; corrected under OPS-118');

    const parked = await harness.intent(id);
    await harness.services.store.intents.save(
      {
        ...parked,
        state: 'RUNNING',
        manualReason: null,
        attempts: {},
        nextAttemptAt: harness.clock.nowIso(),
      },
      parked.version,
    );
    await harness.drain();

    await harness.expectState(id, 'COMPLETED');
    expect((await harness.mocks!.chain.getMarket(TICKER))!.positionSupply.units).toBe(700n);
  });

  /**
   * Regression. `settle_sell` burns *after* the custodian confirms release, so
   * there is a legitimate window where custody has fallen but token supply has
   * not. Before this was allowed for, every ordinary sell raised a CRITICAL
   * shortfall — which, through the mint interlock, froze buying in the name.
   * One sell would have halted the market.
   */
  it('does not cry wolf during the normal sell settlement window', async () => {
    await seedPosition(harness, 500n);
    const { mocks } = harness;

    mocks!.chain.placeSell({
      orderId: 'sell-window',
      ticker: TICKER,
      trader: WALLET,
      quantity: shares(200n),
      limitPrice: hkd(360_00n),
    });
    await harness.watcher.poll();
    const [intent] = await harness.services.store.intents.list({ kind: 'SPOT_SELL' });
    await harness.drain();

    let cur = await harness.intent(intent!.id);
    await mocks!.broker.fill(cur.facts.brokerClientOrderId!, 200n, hkd(360_00n));
    await harness.drain();

    cur = await harness.intent(intent!.id);
    const tradeRef = cur.facts.brokerTradeReference!;
    await mocks!.custodian.acknowledgeTrade(tradeRef, TICKER, shares(200n), hkd(72_000_00n), 'SELL');
    await mocks!.custodian.settle(tradeRef, 'SELL');

    // Custody has released; the burn has not landed yet.
    const custody = await mocks!.custodian.getPosition('MARCO-CUSTODY-01', TICKER);
    const market = await mocks!.chain.getMarket(TICKER);
    expect(custody!.settled.units).toBe(300n);
    expect(market!.positionSupply.units).toBe(500n);

    const run = await reconciler.run({ tickers: [TICKER] });
    expect(run.breaks.find((b) => b.scope === `positions:${TICKER}:backing`)).toBeUndefined();

    // And a genuine shortfall on top of the same window still fires.
    mocks!.custodian.forcePosition(TICKER, 50n);
    const second = await reconciler.run({ tickers: [TICKER] });
    expect(second.breaks.find((b) => b.scope === `positions:${TICKER}:backing`)).toBeDefined();
  });

  it('reports not-ready while any critical break is unresolved', async () => {
    const app = await buildServer({
      services: harness.services,
      runner: harness.runner,
      vaultDriver: harness.vaultDriver,
    });

    harness.mocks!.custodian.forcePosition(TICKER, 10n);
    harness.mocks!.chain.forceSupply(TICKER, 500n);
    await reconciler.run({ tickers: [TICKER] });

    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(503);
    expect(response.json().openCriticalBreaks).toBeGreaterThan(0);

    await app.close();
  });
});
