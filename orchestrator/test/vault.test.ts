import { beforeEach, describe, expect, it } from 'vitest';
import { CASH_ACCOUNTS } from '../src/ledger/accounts.js';
import { createHarness, hkd, seedReadyToTrade, shares, usdc, WALLET, type Harness } from './harness.js';

const VAULT_ID = 'vault-bytedance-01';
const LISTING_ID = 'HK-IPO-BYTEDANCE';
const IPO_TICKER = '9999.HK';

async function seedVault(harness: Harness): Promise<void> {
  const { mocks } = harness;
  mocks!.chain.seedVault({ vaultId: VAULT_ID, cap: usdc(5_000_000_000_000n), feeBps: 500 });
  mocks!.broker.seedListing({
    listingId: LISTING_ID,
    name: 'ByteDance',
    ticker: IPO_TICKER,
    offerPriceRange: { low: hkd(80_00n), high: hkd(100_00n) },
    finalOfferPrice: hkd(100_00n),
    lotSize: 100n,
    applicationOpensAt: '2026-03-01T00:00:00.000Z',
    applicationClosesAt: '2026-04-01T00:00:00.000Z',
    expectedListingAt: '2026-04-10T00:00:00.000Z',
  });
  mocks!.broker.seedInstrument({
    ticker: IPO_TICKER,
    name: 'ByteDance',
    exchange: 'HKEX',
    currency: 'HKD',
    lotSize: 100n,
    tickSize: hkd(2n),
    status: 'TRADING',
  });
}

describe('pre-IPO vault', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    await seedReadyToTrade(harness);
    await seedVault(harness);
  });

  it('screens a subscriber and books the deposit with the fee still refundable', async () => {
    const { mocks, services } = harness;
    const mandate = await harness.vaultDriver.createMandate({
      vaultId: VAULT_ID,
      listingId: LISTING_ID,
      companyName: 'ByteDance',
      electionPeriodSeconds: 0,
      brokerAccountRef: 'MARCO-OMNIBUS-01',
      custodyAccountRef: 'MARCO-CUSTODY-01',
    });

    await harness.vaultDriver.requestPhase(mandate.id, 'Funding');
    await harness.vaultDriver.tick(mandate.id);

    mocks!.chain.vaultDeposit(VAULT_ID, WALLET, usdc(1_000_000_000n));
    await harness.watcher.poll();
    const [intent] = await services.store.intents.list({ kind: 'VAULT_SUBSCRIBE' });
    await harness.drain();

    await harness.expectState(intent!.id, 'COMPLETED');

    // The whole gross amount is still a liability: the 5% fee is refundable
    // until deploy_capital, so recognising it now would overstate revenue on
    // any deal that later cancels.
    expect(services.ledger.balance(CASH_ACCOUNTS.VAULT_SUBSCRIPTION, 'USDC').amount).toBe(
      -1_000_000_000n,
    );
    expect(services.ledger.balance(CASH_ACCOUNTS.INCOME_SPREAD, 'USDC').amount).toBe(0n);
    services.ledger.assertBalanced();
  });

  it('escalates rather than pretending it can unwind a blocked subscriber', async () => {
    const { mocks, services } = harness;
    const mandate = await harness.vaultDriver.createMandate({
      vaultId: VAULT_ID,
      listingId: LISTING_ID,
      companyName: 'ByteDance',
      electionPeriodSeconds: 0,
      brokerAccountRef: 'MARCO-OMNIBUS-01',
      custodyAccountRef: 'MARCO-CUSTODY-01',
    });
    await harness.vaultDriver.requestPhase(mandate.id, 'Funding');
    await harness.vaultDriver.tick(mandate.id);

    mocks!.compliance.setDecision(WALLET, 'BLOCK', ['Sanctions match']);
    mocks!.chain.vaultDeposit(VAULT_ID, WALLET, usdc(1_000_000_000n));
    await harness.watcher.poll();
    const [intent] = await services.store.intents.list({ kind: 'VAULT_SUBSCRIBE' });
    await harness.drain();

    const parked = await harness.expectState(intent!.id, 'NEEDS_MANUAL');
    expect(parked.manualReason).toMatch(/already minted/);
    expect(parked.manualReason).toMatch(/freeze_deposits/);
  });

  it('drives the deal from Scheduled to Claimable, gating each phase on a real event', async () => {
    const { mocks, services } = harness;
    const mandate = await harness.vaultDriver.createMandate({
      vaultId: VAULT_ID,
      listingId: LISTING_ID,
      companyName: 'ByteDance',
      electionPeriodSeconds: 0,
      brokerAccountRef: 'MARCO-OMNIBUS-01',
      custodyAccountRef: 'MARCO-CUSTODY-01',
    });
    const id = mandate.id;

    // ---- Funding ----------------------------------------------------------
    await harness.vaultDriver.requestPhase(id, 'Funding');
    expect((await harness.vaultDriver.tick(id)).advancedTo).toBe('Funding');

    mocks!.chain.vaultDeposit(VAULT_ID, WALLET, usdc(1_000_000_000_000n));

    await harness.vaultDriver.requestPhase(id, 'Sealed');
    expect((await harness.vaultDriver.tick(id)).advancedTo).toBe('Sealed');
    await harness.vaultDriver.requestPhase(id, 'Sourcing');
    expect((await harness.vaultDriver.tick(id)).advancedTo).toBe('Sourcing');

    // ---- Sourcing: the application must be accepted before Sourced --------
    await harness.vaultDriver.requestPhase(id, 'Sourced');
    let result = await harness.vaultDriver.tick(id);
    expect(result.advancedTo).toBeNull();
    expect(result.waiting).toMatch(/accept the application/);

    await mocks!.broker.acceptIpo(`${id}.ipo_application`);
    result = await harness.vaultDriver.tick(id);
    expect(result.advancedTo).toBe('Sourced');

    // ---- Deployed: capital out, fee earned, money crossed and wired -------
    await harness.vaultDriver.requestPhase(id, 'Deployed');
    result = await harness.vaultDriver.tick(id);
    expect(result.waiting).toMatch(/crossing to settle/);

    // The fee became earned the moment capital left for the broker.
    expect(services.ledger.balance(CASH_ACCOUNTS.INCOME_SPREAD, 'USDC').amount).toBe(
      -50_000_000_000n,
    );

    await mocks!.msb.settleConversion(`${id}.deploy_conversion`);
    result = await harness.vaultDriver.tick(id);
    expect(result.waiting).toMatch(/reach the broker/);

    await mocks!.msb.settlePayout(`${id}.deploy_payout`);
    result = await harness.vaultDriver.tick(id);
    expect(result.advancedTo).toBe('Deployed');

    // ---- Live: gated on the CUSTODIAN, not on the listing date ------------
    await harness.vaultDriver.requestPhase(id, 'Live');
    result = await harness.vaultDriver.tick(id);
    expect(result.waiting).toMatch(/ballot result/);

    await mocks!.broker.allocateIpo(`${id}.ipo_application`, shares(5_000n, IPO_TICKER), hkd(500_000_00n));
    result = await harness.vaultDriver.tick(id);
    // Allocated at the broker, but the custodian does not hold them yet.
    expect(result.advancedTo).toBeNull();
    expect(result.waiting).toMatch(/Custodian holds 0 of 5000/);

    mocks!.custodian.seedPosition(IPO_TICKER, 5_000n);
    result = await harness.vaultDriver.tick(id);
    expect(result.advancedTo).toBe('Live');

    // ---- Realized ---------------------------------------------------------
    await harness.vaultDriver.requestPhase(id, 'Realized');
    result = await harness.vaultDriver.tick(id);
    expect(result.waiting).toMatch(/PENDING|NEW/);

    await mocks!.broker.fill(`${id}.sale`, 5_000n, hkd(150_00n));
    result = await harness.vaultDriver.tick(id);
    expect(result.advancedTo).toBe('Realized');

    // ---- Claimable: gated on the USDC actually being back ----------------
    await harness.vaultDriver.requestPhase(id, 'Claimable');
    result = await harness.vaultDriver.tick(id);
    expect(result.advancedTo).toBeNull();
    expect(result.waiting).toMatch(/repatriation to settle/);

    await mocks!.msb.settleConversion(`${id}.repatriation`);
    result = await harness.vaultDriver.tick(id);
    expect(result.advancedTo).toBe('Claimable');

    const onChain = await mocks!.chain.getVault(VAULT_ID);
    expect(onChain!.phase).toBe('Claimable');
    expect(onChain!.redeemableAmount!.amount).toBeGreaterThan(0n);
    services.ledger.assertBalanced();
  });

  it('refuses a phase advance the program would reject', async () => {
    const mandate = await harness.vaultDriver.createMandate({
      vaultId: VAULT_ID,
      listingId: LISTING_ID,
      companyName: 'ByteDance',
      electionPeriodSeconds: 0,
      brokerAccountRef: 'MARCO-OMNIBUS-01',
      custodyAccountRef: 'MARCO-CUSTODY-01',
    });

    // Scheduled → Live is not a transition the program offers.
    await expect(harness.vaultDriver.requestPhase(mandate.id, 'Live')).rejects.toThrow(
      /not a permitted transition/,
    );
  });

  it('will not cancel a vault whose capital has already left', async () => {
    const { mocks } = harness;
    mocks!.chain.seedVault({
      vaultId: 'vault-deployed',
      cap: usdc(1_000_000_000_000n),
      phase: 'Deployed',
    });

    await expect(mocks!.chain.cancelVault('vault-deployed', usdc(0n))).rejects.toThrow(
      /capital has left and cancellation is impossible/,
    );
  });

  it('blocks mark_realized while the delivery-election window is open', async () => {
    const { mocks } = harness;
    mocks!.chain.seedVault({ vaultId: 'vault-live', cap: usdc(1_000n), phase: 'Deployed' });
    await mocks!.chain.markListed('vault-live', shares(1_000n, IPO_TICKER), 3600);

    await expect(mocks!.chain.markRealized('vault-live', hkd(1_000n))).rejects.toThrow(
      /election window is still open/,
    );

    harness.clock.advanceSeconds(3601);
    await expect(mocks!.chain.markRealized('vault-live', hkd(1_000n))).resolves.toBeTruthy();
  });
});
