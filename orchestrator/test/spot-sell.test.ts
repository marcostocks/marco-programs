import { beforeEach, describe, expect, it } from 'vitest';
import { CASH_ACCOUNTS, POSITION_ACCOUNTS } from '../src/ledger/accounts.js';
import {
  createHarness,
  hkd,
  seedPosition,
  seedReadyToTrade,
  shares,
  TICKER,
  WALLET,
  type Harness,
} from './harness.js';

const LIMIT = hkd(360_00n);

async function placeSellAndIngest(harness: Harness, units = 200n): Promise<string> {
  harness.mocks!.chain.placeSell({
    orderId: 'sell-1',
    ticker: TICKER,
    trader: WALLET,
    quantity: shares(units),
    limitPrice: LIMIT,
  });
  await harness.watcher.poll();
  const intents = await harness.services.store.intents.list({ kind: 'SPOT_SELL' });
  return intents[0]!.id;
}

describe('SPOT_SELL', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await seedReadyToTrade(harness);
    await seedPosition(harness, 500n);
  });

  it('burns only after custody releases, then repatriates', async () => {
    const { mocks, services } = harness;
    const id = await placeSellAndIngest(harness);

    // ---- Place and fill ---------------------------------------------------
    await harness.drain();
    let intent = await harness.expectState(id, 'WAITING');
    expect(intent.stage).toBe('place_order');

    await mocks!.broker.fill(intent.facts.brokerClientOrderId!, 200n, LIMIT);
    await harness.drain();
    intent = await harness.intent(id);
    expect(intent.facts.filledQuantity).toEqual(shares(200n));

    // Supply is unchanged: tokens are escrowed, not burned, while the broker
    // is selling — the custodian still holds the share.
    let market = await mocks!.chain.getMarket(TICKER);
    expect(market!.positionSupply.units).toBe(500n);

    // ---- Custody releases -------------------------------------------------
    const tradeRef = intent.facts.brokerTradeReference!;
    await mocks!.custodian.acknowledgeTrade(tradeRef, TICKER, shares(200n), hkd(72_000_00n), 'SELL');
    await harness.drain();

    // Acknowledged is not settled — still no burn.
    market = await mocks!.chain.getMarket(TICKER);
    expect(market!.positionSupply.units).toBe(500n);

    await mocks!.custodian.settle(tradeRef, 'SELL');
    await harness.drain();

    // ---- Settled on-chain, awaiting repatriation --------------------------
    intent = await harness.intent(id);
    expect(intent.facts.settleSignature).toBeTruthy();
    market = await mocks!.chain.getMarket(TICKER);
    expect(market!.positionSupply.units).toBe(300n);

    // The seller was paid from the float before the HKD came home.
    expect(services.ledger.balance(CASH_ACCOUNTS.TREASURY_USDC, 'USDC').amount).toBeLessThan(
      1_000_000_000_000n,
    );

    // ---- Repatriate -------------------------------------------------------
    intent = await harness.expectState(id, 'WAITING');
    await mocks!.msb.settleConversion(intent.facts.conversionRef!);
    await harness.drain();

    await harness.expectState(id, 'COMPLETED');
    services.ledger.assertBalanced();

    expect(services.ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTOMER_POSITIONS, TICKER)).toBe(
      -300n,
    );
    expect(services.ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTODY_OUTBOUND, TICKER)).toBe(
      0n,
    );
    expect(services.ledger.balance(CASH_ACCOUNTS.CUSTOMER_PROCEEDS, 'HKD').amount).toBe(0n);
  });

  it('refuses to sell shares the custodian does not hold', async () => {
    const { mocks } = harness;
    // Custody is short against the tokens outstanding — the backing invariant
    // is already broken, and selling would compound it.
    mocks!.custodian.forcePosition(TICKER, 50n);

    const id = await placeSellAndIngest(harness);
    await harness.drain();

    const intent = await harness.expectState(id, 'NEEDS_MANUAL');
    expect(intent.manualReason).toMatch(/Reconcile before selling/);
    expect(await mocks!.broker.getOrder(`${id}.place_order`)).toBeNull();
  });

  it('parks a delisted name rather than trying to sell it', async () => {
    harness.mocks!.broker.setInstrumentStatus(TICKER, 'DELISTED');
    const id = await placeSellAndIngest(harness);
    await harness.drain();

    const intent = await harness.expectState(id, 'NEEDS_MANUAL');
    expect(intent.manualReason).toMatch(/delisted/);
  });

  it('parks a fill below the seller’s limit', async () => {
    const { mocks } = harness;
    const id = await placeSellAndIngest(harness);
    await harness.drain();

    const intent = await harness.intent(id);
    await mocks!.broker.fill(intent.facts.brokerClientOrderId!, 200n, hkd(359_00n));
    await harness.drain();

    const parked = await harness.expectState(id, 'NEEDS_MANUAL');
    expect(parked.manualReason).toMatch(/below the seller's limit/);
  });
});
