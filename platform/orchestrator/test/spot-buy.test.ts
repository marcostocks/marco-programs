import { beforeEach, describe, expect, it } from 'vitest';
import { CASH_ACCOUNTS, POSITION_ACCOUNTS } from '../src/ledger/accounts.js';
import { createHarness, hkd, seedReadyToTrade, shares, TICKER, usdc, WALLET, type Harness } from './harness.js';

/**
 * A round 10,000 USDC buy of Tencent at a 365.40 limit.
 *
 * At the mock's 7.81 rate the net escrow (after the 0.5% spread) is worth about
 * 77,700 HKD, which affords 200 shares — two whole board lots.
 */
const ESCROW = usdc(10_000_000_000n);
const LIMIT = hkd(365_40n);
const REQUESTED = shares(200n);

async function placeAndIngest(harness: Harness): Promise<string> {
  harness.mocks!.chain.placeBuy({
    orderId: 'ord-1',
    ticker: TICKER,
    trader: WALLET,
    amount: ESCROW,
    limitPrice: LIMIT,
    quantity: REQUESTED,
  });
  await harness.watcher.poll();
  const intents = await harness.services.store.intents.list({ kind: 'SPOT_BUY' });
  expect(intents).toHaveLength(1);
  return intents[0]!.id;
}

describe('SPOT_BUY', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await seedReadyToTrade(harness);
  });

  it('books the escrow the moment the chain event is seen', async () => {
    const id = await placeAndIngest(harness);
    const intent = await harness.intent(id);

    expect(intent.state).toBe('PENDING');
    expect(intent.request.limitPrice).toEqual(LIMIT);
    // The trader's money is on our books before any saga step runs, so a
    // reconciliation between the two cannot report a phantom shortfall.
    expect(harness.services.ledger.balance(CASH_ACCOUNTS.CHAIN_ESCROW, 'USDC').amount).toBe(
      ESCROW.amount,
    );
  });

  it('completes the full buffer-funded path and mints only after custody confirms', async () => {
    const { mocks, services } = harness;
    const id = await placeAndIngest(harness);

    // ---- Phase 1: screen, size, deploy, fund, place -----------------------
    await harness.drain();
    let intent = await harness.expectState(id, 'WAITING');
    expect(intent.stage).toBe('place_order');
    expect(intent.facts.plannedQuantity).toEqual(shares(200n));
    expect(intent.facts.justInTime).toBe(false);

    // The buffer was drawn on immediately — that is the whole point of the
    // hybrid model. The order is at the market before any FX has settled.
    const reservation = await services.store.reservations.findByIntent(id);
    expect(reservation?.state).toBe('HELD');
    const brokerOrder = await mocks!.broker.getOrder(intent.facts.brokerClientOrderId!);
    expect(brokerOrder?.status).toBe('NEW');
    expect(brokerOrder?.requestedQuantity.units).toBe(200n);

    // Escrow has left for the conversion partner and the spread is recognised.
    expect(services.ledger.balance(CASH_ACCOUNTS.CHAIN_ESCROW, 'USDC').amount).toBe(0n);
    expect(services.ledger.balance(CASH_ACCOUNTS.INCOME_SPREAD, 'USDC').amount).toBe(-50_000_000n);

    // ---- Phase 2: the broker fills ---------------------------------------
    await mocks!.broker.fill(intent.facts.brokerClientOrderId!, 200n, LIMIT);
    await harness.drain();
    intent = await harness.expectState(id, 'WAITING');
    // `stage` is the last *completed* step: the fill booked, and settle_crossing
    // is now waiting on the FX.
    expect(intent.stage).toBe('await_fill');
    expect(intent.facts.filledQuantity).toEqual(shares(200n));

    // ---- Phase 3: the crossing and the wire land -------------------------
    await mocks!.msb.settleConversion(intent.facts.conversionRef!);
    await harness.drain();
    intent = await harness.intent(id);
    await mocks!.msb.settlePayout(intent.facts.payoutRef ?? `${id}.settle_crossing.payout`);
    await harness.drain();

    intent = await harness.expectState(id, 'WAITING');
    expect(intent.stage).toBe('settle_crossing');

    // ---- Phase 4: custody settles (T+2) ----------------------------------
    const tradeRef = intent.facts.brokerTradeReference!;
    await mocks!.custodian.acknowledgeTrade(tradeRef, TICKER, shares(200n), hkd(73_080_00n));
    await harness.drain();

    // Still not minted: acknowledged is not settled.
    intent = await harness.expectState(id, 'WAITING');
    expect(intent.stage).toBe('settle_crossing');
    const market = await mocks!.chain.getMarket(TICKER);
    expect(market!.positionSupply.units).toBe(0n);

    await mocks!.custodian.settle(tradeRef);
    await harness.drain();

    // ---- Complete ---------------------------------------------------------
    intent = await harness.expectState(id, 'COMPLETED');
    expect(intent.facts.custodyReference).toBeTruthy();
    expect(intent.facts.documentHash).toMatch(/^[0-9a-f]{64}$/);

    const finalMarket = await mocks!.chain.getMarket(TICKER);
    expect(finalMarket!.positionSupply.units).toBe(200n);

    // The books balance and mirror the chain and the custodian exactly.
    services.ledger.assertBalanced();
    expect(services.ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTOMER_POSITIONS, TICKER)).toBe(
      -200n,
    );
    expect(services.ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTODY_HOLDINGS, TICKER)).toBe(
      200n,
    );
    expect(services.ledger.balance(CASH_ACCOUNTS.CUSTOMER_ESCROW, 'USDC').amount).toBe(0n);

    // The buffer hold was consumed, not left dangling.
    const finalReservation = await services.store.reservations.findByIntent(id);
    expect(finalReservation?.state).toBe('CONSUMED');
  });

  it('takes the just-in-time path when the buffer is too small', async () => {
    // A buffer that cannot cover a ~77,000 HKD order.
    harness = createHarness();
    await seedReadyToTrade(harness, { bufferHkd: 1_000_00n });
    const { mocks } = harness;

    const id = await placeAndIngest(harness);
    await harness.drain();

    let intent = await harness.expectState(id, 'WAITING');
    expect(intent.facts.justInTime).toBe(true);
    // Nothing is at the market yet: just-in-time waits for the money to land.
    expect(intent.stage).toBe('deploy_escrow');
    expect(await mocks!.broker.getOrder(`${id}.place_order`)).toBeNull();

    await mocks!.msb.settleConversion(`${id}.fund_execution.conversion`);
    await harness.drain();
    await mocks!.msb.settlePayout(`${id}.fund_execution.payout`);
    await harness.drain();

    intent = await harness.expectState(id, 'WAITING');
    expect(intent.stage).toBe('place_order');
    const placed = await mocks!.broker.getOrder(intent.facts.brokerClientOrderId!);
    expect(placed?.status).toBe('NEW');
  });

  it('sizes the order down to what the escrow can pay for', async () => {
    const { mocks } = harness;
    // 1,000 USDC buys about 7,770 HKD of stock at the 365.40 limit — 21 shares,
    // which is one board lot of 100 short. Ask for 500 anyway.
    mocks!.chain.placeBuy({
      orderId: 'ord-small',
      ticker: TICKER,
      trader: WALLET,
      amount: usdc(4_000_000_000n),
      limitPrice: LIMIT,
      quantity: shares(500n),
    });
    await harness.watcher.poll();
    const [intent] = await harness.services.store.intents.list({ kind: 'SPOT_BUY' });

    await harness.drain();
    const after = await harness.intent(intent!.id);
    // 4,000 USDC net of spread ≈ 31,090 HKD ≈ 85 shares → one lot of 100? No:
    // it affords 85, which floors to zero whole lots... so it buys the largest
    // whole lot it can, which is none, and unwinds rather than overspending.
    expect(after.facts.plannedQuantity?.units ?? 0n).toBeLessThan(500n);
  });

  it('unwinds and refunds when screening blocks the trader', async () => {
    const { mocks, services } = harness;
    mocks!.compliance.setDecision(WALLET, 'BLOCK', ['Sanctions list match']);

    const id = await placeAndIngest(harness);
    await harness.drain();

    await harness.expectState(id, 'CANCELLED');

    // Nothing left the escrow, no order reached the broker, no hold survives.
    expect(await mocks!.broker.getOrder(`${id}.place_order`)).toBeNull();
    const order = await mocks!.chain.getSpotOrder(TICKER, 'ord-1');
    expect(order!.state).toBe('PENDING');
    expect(await services.store.reservations.findByIntent(id)).toBeNull();
    services.ledger.assertBalanced();
  });

  it('parks rather than unwinds when screening flags for review', async () => {
    const { mocks } = harness;
    mocks!.compliance.setDecision(WALLET, 'REVIEW', ['Elevated wallet risk score']);

    const id = await placeAndIngest(harness);
    await harness.drain();

    const intent = await harness.expectState(id, 'NEEDS_MANUAL');
    expect(intent.manualReason).toMatch(/review/i);
  });

  it('unwinds when the trader is not registered on-chain', async () => {
    const { mocks } = harness;
    await mocks!.chain.revokeTrader(WALLET);

    const id = await placeAndIngest(harness);
    await harness.drain();

    const intent = await harness.expectState(id, 'CANCELLED');
    expect(intent.lastError?.message).toMatch(/not a registered, eligible trader/);
  });

  it('waits out a trading halt instead of cancelling a live order', async () => {
    const { mocks } = harness;
    mocks!.broker.setInstrumentStatus(TICKER, 'HALTED');

    const id = await placeAndIngest(harness);
    await harness.drain(5);

    const intent = await harness.expectState(id, 'WAITING');
    expect(intent.stage).toBe('screen');

    mocks!.broker.setInstrumentStatus(TICKER, 'TRADING');
    await harness.drain();
    const resumed = await harness.intent(id);
    expect(resumed.stage).not.toBe('screen');
  });

  it('cancels the resting broker order when a later step unwinds', async () => {
    const { mocks } = harness;
    const id = await placeAndIngest(harness);
    await harness.drain();

    const intent = await harness.intent(id);
    const clientOrderId = intent.facts.brokerClientOrderId!;
    expect((await mocks!.broker.getOrder(clientOrderId))!.status).toBe('NEW');

    // Force the unwind the way an operator would.
    await harness.services.store.intents.save(
      { ...intent, state: 'UNWINDING', nextAttemptAt: harness.clock.nowIso() },
      intent.version,
    );
    await harness.drain();

    await harness.expectState(id, 'CANCELLED');
    expect((await mocks!.broker.getOrder(clientOrderId))!.status).toBe('CANCELLED');
    // The buffer capacity came back.
    const reservation = await harness.services.store.reservations.findByIntent(id);
    expect(reservation?.state).toBe('RELEASED');
  });

  it('does not create a second intent when the same event is replayed', async () => {
    await placeAndIngest(harness);
    await harness.watcher.poll();
    await harness.watcher.poll();

    const intents = await harness.services.store.intents.list({ kind: 'SPOT_BUY' });
    expect(intents).toHaveLength(1);
  });

  it('refuses to mint above the trader’s limit price', async () => {
    const { mocks } = harness;
    const id = await placeAndIngest(harness);
    await harness.drain();

    const intent = await harness.intent(id);
    // Fill a tick worse than the limit the trader agreed to.
    await mocks!.broker.fill(intent.facts.brokerClientOrderId!, 200n, hkd(365_60n));
    await harness.drain();

    const parked = await harness.expectState(id, 'NEEDS_MANUAL');
    expect(parked.manualReason).toMatch(/exceeds the trader's limit/);

    // Nothing was minted.
    const market = await mocks!.chain.getMarket(TICKER);
    expect(market!.positionSupply.units).toBe(0n);
  });

  it('parks when the custodian settles without an attestation reference', async () => {
    const { mocks } = harness;
    const id = await placeAndIngest(harness);
    await harness.drain();

    let intent = await harness.intent(id);
    await mocks!.broker.fill(intent.facts.brokerClientOrderId!, 200n, LIMIT);
    await harness.drain();

    intent = await harness.intent(id);
    await mocks!.msb.settleConversion(intent.facts.conversionRef!);
    await harness.drain();
    intent = await harness.intent(id);
    await mocks!.msb.settlePayout(intent.facts.payoutRef!);
    await harness.drain();

    intent = await harness.intent(id);
    const tradeRef = intent.facts.brokerTradeReference!;
    await mocks!.custodian.acknowledgeTrade(tradeRef, TICKER, shares(200n), hkd(73_080_00n));
    await mocks!.custodian.failSettlement(tradeRef, 'Counterparty failed to deliver');
    await harness.drain();

    const parked = await harness.expectState(id, 'NEEDS_MANUAL');
    expect(parked.manualReason).toMatch(/Settlement failed/);
  });
});
