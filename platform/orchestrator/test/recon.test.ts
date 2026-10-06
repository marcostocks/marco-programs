import { beforeEach, describe, expect, it } from 'vitest';
import { Reconciler } from '../src/recon/reconciler.js';
import { createHarness, seedPosition, seedReadyToTrade, TICKER, type Harness } from './harness.js';

describe('reconciliation', () => {
  let harness: Harness;
  let reconciler: Reconciler;

  beforeEach(async () => {
    harness = createHarness();
    await seedReadyToTrade(harness);
    await seedPosition(harness, 500n);
    reconciler = new Reconciler(harness.services);
  });

  it('is clean when the ledger, the chain and the custodian agree', async () => {
    const run = await reconciler.run({ tickers: [TICKER] });
    expect(run.breaks.map((b) => `${b.scope}: ${b.description}`)).toEqual([]);
    expect(run.clean).toBe(true);
  });

  it('catches token supply drifting from the ledger obligation', async () => {
    // Someone minted outside the orchestrator.
    harness.mocks!.chain.forceSupply(TICKER, 700n);

    const run = await reconciler.run({ tickers: [TICKER] });
    const supplyBreak = run.breaks.find((b) => b.scope === `positions:${TICKER}:supply`);

    expect(supplyBreak).toBeDefined();
    expect(supplyBreak!.severity).toBe('CRITICAL');
    expect(supplyBreak!.chainValue).toBe('700');
    expect(supplyBreak!.ledgerValue).toBe('500');
    expect(supplyBreak!.delta).toBe('200');
  });

  it('raises a backing shortfall when custody holds less than the tokens outstanding', async () => {
    harness.mocks!.custodian.forcePosition(TICKER, 400n);

    const run = await reconciler.run({ tickers: [TICKER] });
    const backing = run.breaks.find((b) => b.scope === `positions:${TICKER}:backing`);

    expect(backing).toBeDefined();
    expect(backing!.severity).toBe('CRITICAL');
    expect(backing!.description).toMatch(/BACKING SHORTFALL/);
    expect(backing!.description).toMatch(/Halt the market/);
  });

  it('catches on-chain escrow drifting from the books', async () => {
    // Book USDC that is not actually locked on-chain.
    await harness.services.ledger.post({
      reference: 'test.phantom_escrow',
      memo: 'escrow the chain does not have',
      cash: [
        { account: 'asset.chain.escrow', currency: 'USDC', amount: 5_000_000n },
        { account: 'liability.customer.escrow', currency: 'USDC', amount: -5_000_000n },
      ],
    });

    const run = await reconciler.run({ tickers: [TICKER] });
    const escrowBreak = run.breaks.find((b) => b.scope === 'cash:chain_escrow:USDC');

    expect(escrowBreak).toBeDefined();
    expect(escrowBreak!.chainValue).toBe('0');
    expect(escrowBreak!.ledgerValue).toBe('5000000');
  });

  it('surfaces parked intents as a break so nothing sits unnoticed', async () => {
    const now = harness.clock.nowIso();
    await harness.services.store.intents.create({
      id: 'int_parked',
      kind: 'SPOT_BUY',
      state: 'NEEDS_MANUAL',
      stage: 'await_custody',
      wallet: 'w',
      source: { signature: 's', slot: 1, observedAt: now },
      request: {},
      facts: {},
      attempts: {},
      lastError: null,
      nextAttemptAt: null,
      manualReason: 'Custodian settled without a position reference',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const run = await reconciler.run({ tickers: [TICKER] });
    const stale = run.breaks.find((b) => b.scope === 'intents:needs_manual');
    expect(stale).toBeDefined();
    expect(stale!.relatedIntentIds).toContain('int_parked');
  });

  it('reuses one open break across runs rather than alerting every time', async () => {
    harness.mocks!.chain.forceSupply(TICKER, 700n);

    const first = await reconciler.run({ tickers: [TICKER] });
    const second = await reconciler.run({ tickers: [TICKER] });

    const firstBreak = first.breaks.find((b) => b.scope === `positions:${TICKER}:supply`)!;
    const secondBreak = second.breaks.find((b) => b.scope === `positions:${TICKER}:supply`)!;
    expect(secondBreak.id).toBe(firstBreak.id);

    const open = await harness.services.store.breaks.list({ status: 'OPEN' });
    expect(open.filter((b) => b.scope === `positions:${TICKER}:supply`)).toHaveLength(1);
  });

  it('will not close a break without a written resolution', async () => {
    harness.mocks!.chain.forceSupply(TICKER, 700n);
    const run = await reconciler.run({ tickers: [TICKER] });
    const item = run.breaks.find((b) => b.scope === `positions:${TICKER}:supply`)!;

    await expect(reconciler.resolveBreak(item.id, '   ')).rejects.toThrow(/resolution note/);

    const resolved = await reconciler.resolveBreak(item.id, 'Manual mint reversed under CR-4471');
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution).toBe('Manual mint reversed under CR-4471');
  });

  it('flags a non-zero suspense balance', async () => {
    await harness.services.ledger.post({
      reference: 'test.suspense',
      memo: 'unexplained difference',
      cash: [
        { account: 'clearing.suspense', currency: 'USDC', amount: 1_000n },
        { account: 'asset.msb.transit', currency: 'USDC', amount: -1_000n },
      ],
    });

    const run = await reconciler.run({ tickers: [] });
    expect(run.breaks.find((b) => b.scope === 'suspense:USDC')?.severity).toBe('CRITICAL');
  });
});
