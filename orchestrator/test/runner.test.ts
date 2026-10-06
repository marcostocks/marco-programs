/**
 * Runner semantics.
 *
 * These are the tests that matter most for not losing money: what the runner
 * does when it cannot tell whether an effect happened.
 */

import { describe, expect, it } from 'vitest';
import {
  CounterpartyIndeterminate,
  CounterpartyRejection,
  CounterpartyUnavailable,
} from '../src/domain/errors.js';
import { newId } from '../src/domain/ids.js';
import { SagaRunner, type Saga, type Step } from '../src/orchestration/runner.js';
import type { Intent } from '../src/orchestration/intent.js';
import type { Services } from '../src/services.js';
import { createHarness, WALLET, type Harness } from './harness.js';

interface Recorder {
  runs: string[];
  resolves: string[];
  compensations: string[];
}

function makeRecorder(): Recorder {
  return { runs: [], resolves: [], compensations: [] };
}

async function seedIntent(harness: Harness): Promise<Intent> {
  const now = harness.clock.nowIso();
  return harness.services.store.intents.create({
    id: newId('int'),
    kind: 'SPOT_BUY',
    state: 'PENDING',
    stage: '',
    wallet: WALLET,
    source: { signature: `sig_${Math.random()}`, slot: 1, observedAt: now },
    request: {},
    facts: {},
    attempts: {},
    lastError: null,
    nextAttemptAt: now,
    manualReason: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

function buildRunner(harness: Harness, steps: Step<Services>[]): SagaRunner<Services> {
  const saga: Saga<Services> = { kind: 'SPOT_BUY', steps };
  return new SagaRunner<Services>({
    sagas: [saga],
    services: harness.services,
    store: harness.services.store,
    clock: harness.clock,
    logger: harness.logger,
    policy: { ...harness.services.config.runner, baseBackoffMillis: 1, maxAttempts: 3 },
  });
}

describe('saga runner', () => {
  it('drives a chain of local steps to completion in one pass', async () => {
    const harness = createHarness();
    const recorder = makeRecorder();
    const steps: Step<Services>[] = ['a', 'b', 'c'].map((name) => ({
      name,
      async run() {
        recorder.runs.push(name);
        return { kind: 'ADVANCE' as const };
      },
    }));

    const runner = buildRunner(harness, steps);
    const intent = await seedIntent(harness);
    const state = await runner.drive(intent);

    expect(state).toBe('COMPLETED');
    expect(recorder.runs).toEqual(['a', 'b', 'c']);
  });

  it('retries a retryable failure with backoff, then parks at the ceiling', async () => {
    const harness = createHarness();
    let attempts = 0;
    const steps: Step<Services>[] = [
      {
        name: 'flaky',
        async run() {
          attempts += 1;
          throw new CounterpartyUnavailable('broker', 'connection refused');
        },
      },
    ];

    const runner = buildRunner(harness, steps);
    let intent = await seedIntent(harness);

    for (let i = 0; i < 5; i += 1) {
      const claimed = await harness.services.store.intents.claimDue(harness.clock.nowIso(), 10, 1000);
      if (claimed.length === 0) {
        harness.clock.advance(60_000);
        continue;
      }
      await runner.drive(claimed[0]!);
      harness.clock.advance(60_000);
    }

    intent = (await harness.services.store.intents.get(intent.id))!;
    expect(intent.state).toBe('NEEDS_MANUAL');
    expect(attempts).toBe(3);
    expect(intent.manualReason).toMatch(/failed 3 times/);
  });

  it('unwinds on a terminal failure and runs compensations in reverse', async () => {
    const harness = createHarness();
    const recorder = makeRecorder();

    const steps: Step<Services>[] = [
      {
        name: 'first',
        async run() {
          return { kind: 'ADVANCE' as const };
        },
        async compensate() {
          recorder.compensations.push('first');
        },
      },
      {
        name: 'second',
        async run() {
          return { kind: 'ADVANCE' as const };
        },
        async compensate() {
          recorder.compensations.push('second');
        },
      },
      {
        name: 'third',
        async run(): Promise<never> {
          throw new CounterpartyRejection('broker', 'insufficient buying power');
        },
      },
    ];

    const runner = buildRunner(harness, steps);
    const intent = await seedIntent(harness);
    await runner.drive(intent);

    const unwinding = (await harness.services.store.intents.get(intent.id))!;
    expect(unwinding.state).toBe('UNWINDING');

    await runner.drive(unwinding);
    const done = (await harness.services.store.intents.get(intent.id))!;
    expect(done.state).toBe('CANCELLED');
    expect(recorder.compensations).toEqual(['second', 'first']);
  });

  describe('ambiguity', () => {
    it('never retries an ambiguous effect — it asks the counterparty instead', async () => {
      const harness = createHarness();
      const recorder = makeRecorder();
      let runCount = 0;

      const steps: Step<Services>[] = [
        {
          name: 'wire_money',
          async run(): Promise<never> {
            runCount += 1;
            // A timeout on a payment. We cannot tell whether it went out.
            throw new CounterpartyIndeterminate('msb', 'socket hang up after 30s');
          },
          async resolve(ctx) {
            recorder.resolves.push(ctx.clientRef);
            // Query by our deterministic reference: it did land.
            return { kind: 'ADVANCE' as const, facts: { payoutRef: ctx.clientRef } };
          },
        },
      ];

      const runner = buildRunner(harness, steps);
      const intent = await seedIntent(harness);
      const state = await runner.drive(intent);

      expect(state).toBe('COMPLETED');
      // The effect ran exactly once. It was never retried on faith.
      expect(runCount).toBe(1);
      expect(recorder.resolves).toHaveLength(1);
      expect(recorder.resolves[0]).toBe(`${intent.id}.wire_money`);
    });

    it('parks when the resolver cannot determine what happened', async () => {
      const harness = createHarness();
      const steps: Step<Services>[] = [
        {
          name: 'wire_money',
          async run(): Promise<never> {
            throw new CounterpartyIndeterminate('msb', 'gateway timeout');
          },
          async resolve() {
            return null;
          },
        },
      ];

      const runner = buildRunner(harness, steps);
      const intent = await seedIntent(harness);
      const state = await runner.drive(intent);

      expect(state).toBe('NEEDS_MANUAL');
      const parked = (await harness.services.store.intents.get(intent.id))!;
      expect(parked.manualReason).toMatch(/indeterminate outcome/);
      expect(parked.manualReason).toContain(`${intent.id}.wire_money`);
    });

    it('parks a money-moving step that defines no resolver', async () => {
      const harness = createHarness();
      const steps: Step<Services>[] = [
        {
          name: 'wire_money',
          async run(): Promise<never> {
            throw new CounterpartyIndeterminate('msb', 'gateway timeout');
          },
        },
      ];

      const runner = buildRunner(harness, steps);
      const intent = await seedIntent(harness);
      expect(await runner.drive(intent)).toBe('NEEDS_MANUAL');
    });

    it('treats an unclassified throw as ambiguous, not as retryable', async () => {
      const harness = createHarness();
      let runCount = 0;
      const steps: Step<Services>[] = [
        {
          name: 'unknown_failure',
          async run(): Promise<never> {
            runCount += 1;
            throw new Error('something from deep inside an SDK');
          },
        },
      ];

      const runner = buildRunner(harness, steps);
      const intent = await seedIntent(harness);
      expect(await runner.drive(intent)).toBe('NEEDS_MANUAL');
      expect(runCount).toBe(1);
    });
  });

  describe('crash recovery', () => {
    it('resolves an attempt that was in flight when the process died', async () => {
      const harness = createHarness();
      const recorder = makeRecorder();
      let runCount = 0;

      const steps: Step<Services>[] = [
        {
          name: 'wire_money',
          async run() {
            runCount += 1;
            return { kind: 'ADVANCE' as const };
          },
          async resolve(ctx) {
            recorder.resolves.push(ctx.clientRef);
            return { kind: 'ADVANCE' as const };
          },
        },
      ];

      const runner = buildRunner(harness, steps);
      const intent = await seedIntent(harness);

      // Simulate dying mid-effect: the write-ahead attempt exists with no
      // recorded outcome, exactly as it would after a hard kill.
      await harness.services.store.attempts.begin({
        id: newId('evt'),
        intentId: intent.id,
        step: 'wire_money',
        attempt: 1,
        clientRef: `${intent.id}.wire_money`,
        startedAt: harness.clock.nowIso(),
        finishedAt: null,
        outcome: null,
        error: null,
      });

      const state = await runner.drive(intent);

      expect(state).toBe('COMPLETED');
      // The effect was NOT re-run. Recovery went through the resolver.
      expect(runCount).toBe(0);
      expect(recorder.resolves).toHaveLength(1);
    });

    it('parks a resumed intent whose saga no longer contains its last stage', async () => {
      const harness = createHarness();
      const steps: Step<Services>[] = [
        { name: 'renamed_step', async run() { return { kind: 'ADVANCE' as const }; } },
      ];

      const runner = buildRunner(harness, steps);
      const intent = await seedIntent(harness);
      await harness.services.store.intents.save(
        { ...intent, state: 'RUNNING', stage: 'step_that_no_longer_exists' },
        intent.version,
      );

      const reloaded = (await harness.services.store.intents.get(intent.id))!;
      expect(await runner.drive(reloaded)).toBe('NEEDS_MANUAL');
    });
  });

  it('records a write-ahead attempt before every effect', async () => {
    const harness = createHarness();
    const steps: Step<Services>[] = [
      { name: 'only', async run() { return { kind: 'ADVANCE' as const }; } },
    ];

    const runner = buildRunner(harness, steps);
    const intent = await seedIntent(harness);
    await runner.drive(intent);

    const attempts = await harness.services.store.attempts.listForIntent(intent.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.clientRef).toBe(`${intent.id}.only`);
    expect(attempts[0]!.outcome).toBe('OK');
    expect(attempts[0]!.finishedAt).not.toBeNull();
  });
});
