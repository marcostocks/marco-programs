import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, hkd, seedReadyToTrade, type Harness } from './harness.js';

describe('treasury buffer', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = createHarness();
    // 5,000,000.00 HKD working balance.
    await seedReadyToTrade(harness);
  });

  it('reports available as balance less outstanding holds', async () => {
    const { treasury } = harness.services;

    let snapshot = await treasury.snapshot('HKD');
    expect(snapshot.balance.amount).toBe(5_000_000_00n);
    expect(snapshot.available.amount).toBe(5_000_000_00n);
    expect(snapshot.healthy).toBe(true);

    await treasury.reserve('int_a', hkd(1_000_000_00n));

    snapshot = await treasury.snapshot('HKD');
    // A reservation is a memo, not a movement: the balance is untouched.
    expect(snapshot.balance.amount).toBe(5_000_000_00n);
    expect(snapshot.held.amount).toBe(1_000_000_00n);
    expect(snapshot.available.amount).toBe(4_000_000_00n);
  });

  it('returns the existing hold when an intent reserves twice', async () => {
    const { treasury } = harness.services;
    const first = await treasury.reserve('int_a', hkd(1_000_000_00n));
    const second = await treasury.reserve('int_a', hkd(1_000_000_00n));

    expect(second.id).toBe(first.id);
    expect((await treasury.snapshot('HKD')).held.amount).toBe(1_000_000_00n);
  });

  it('refuses to overdraw the buffer', async () => {
    const { treasury } = harness.services;
    // Draw the 5,000,000.00 buffer down to 100,000.00 available.
    for (const id of ['a', 'b', 'c', 'd']) {
      await treasury.reserve(`int_${id}`, hkd(1_000_000_00n));
    }
    await treasury.reserve('int_e', hkd(900_000_00n));
    expect((await treasury.snapshot('HKD')).available.amount).toBe(100_000_00n);

    // Within the per-intent ceiling, but more than the buffer has left.
    expect(await treasury.canFund(hkd(500_000_00n))).toBe(false);
    await expect(treasury.reserve('int_f', hkd(500_000_00n))).rejects.toThrow(
      /Buffer has 10000000 HKD available/,
    );
  });

  it('enforces the per-intent ceiling', async () => {
    const { treasury } = harness.services;
    // The test policy caps a single reservation at 1,000,000.00 HKD.
    await expect(treasury.reserve('int_big', hkd(2_000_000_00n))).rejects.toThrow(
      /exceeds the per-intent ceiling/,
    );
  });

  it('returns capacity on release and keeps it on consume', async () => {
    const { treasury } = harness.services;

    const held = await treasury.reserve('int_a', hkd(1_000_000_00n));
    await treasury.release(held.id);
    expect((await treasury.snapshot('HKD')).available.amount).toBe(5_000_000_00n);

    const consumed = await treasury.reserve('int_b', hkd(1_000_000_00n));
    await treasury.consume(consumed.id);
    // Consumed capital is gone from holds; the actual spend is a ledger event.
    expect((await treasury.snapshot('HKD')).held.amount).toBe(0n);
  });

  it('sweeps a hold whose intent died, so capacity is not locked forever', async () => {
    const { treasury } = harness.services;
    await treasury.reserve('int_dead', hkd(1_000_000_00n));

    expect(await treasury.sweepExpired()).toHaveLength(0);

    harness.clock.advanceSeconds(6 * 60 * 60 + 1);
    const swept = await treasury.sweepExpired();

    expect(swept).toHaveLength(1);
    expect(swept[0]!.state).toBe('EXPIRED');
    expect((await treasury.snapshot('HKD')).available.amount).toBe(5_000_000_00n);
  });

  it('plans a top-up rounded up to the policy increment', async () => {
    // Policy: target 500,000.00, minimum 150,000.00, increment 250,000.00.
    // Start from a 200,000.00 buffer so a single draw takes it under.
    const small = createHarness();
    await seedReadyToTrade(small, { bufferHkd: 200_000_00n });
    const { treasury } = small.services;

    expect((await treasury.snapshot('HKD')).healthy).toBe(true);
    expect(await treasury.assessTopUp('HKD')).toBeNull();

    await treasury.reserve('int_a', hkd(100_000_00n));

    const snapshot = await treasury.snapshot('HKD');
    expect(snapshot.available.amount).toBe(100_000_00n);
    expect(snapshot.healthy).toBe(false);

    const plan = await treasury.assessTopUp('HKD');
    expect(plan).not.toBeNull();
    // Shortfall of 400,000.00, rounded up to two 250,000.00 increments.
    expect(plan!.amount.amount).toBe(500_000_00n);
    expect(plan!.reason).toMatch(/below the/);
  });

  it('refuses a currency it holds no buffer in', async () => {
    await expect(harness.services.treasury.snapshot('CNH')).rejects.toThrow(
      /No treasury buffer is maintained in CNH/,
    );
  });
});
