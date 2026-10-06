/**
 * The saga runner.
 *
 * A saga is an ordered list of steps. The runner walks an intent through them,
 * writing a journal entry *before* each side effect so that a crash always
 * leaves evidence of what might be in flight.
 *
 * The three rules that matter:
 *
 *  1. **Never retry an ambiguous effect.** If a step throws something we cannot
 *     classify as definitely-did-not-happen, the runner asks the counterparty
 *     what it knows about our deterministic `clientRef`. If that is
 *     inconclusive the intent parks for a human. It does not guess, and it
 *     does not try again.
 *
 *  2. **Steps are re-entrant.** A step that is waiting on an external event is
 *     re-run on each poll and must re-derive its answer from live state, not
 *     from having been called before.
 *
 *  3. **Unwinding is explicit.** Compensations run in reverse order over the
 *     steps that actually completed. A step with no compensation had no effect
 *     worth undoing, and that is a claim the author makes deliberately.
 */

import type { Clock } from '../domain/clock.js';
import { describeError, dispositionOf } from '../domain/errors.js';
import { clientRef as makeClientRef, newId, type IdSource, systemIdSource } from '../domain/ids.js';
import type {
  Intent,
  IntentErrorRecord,
  IntentFacts,
  IntentKind,
  IntentState,
  StepAttempt,
} from './intent.js';
import { assertTransition, isTerminal } from './intent.js';
import type { Store } from '../ports/store.js';
import type { Logger } from '../support/logger.js';

/* -------------------------------------------------------------------------- */
/* Step contract                                                               */
/* -------------------------------------------------------------------------- */

export type StepResult =
  /** Done. Merge facts and move to the next step. */
  | { readonly kind: 'ADVANCE'; readonly facts?: Partial<IntentFacts> }
  /** Blocked on an external event. Re-run on the next poll. */
  | {
      readonly kind: 'WAIT';
      readonly reason: string;
      readonly facts?: Partial<IntentFacts>;
      readonly retryAfterMillis?: number;
    }
  /** Cannot proceed. Unwind everything completed so far. */
  | { readonly kind: 'UNWIND'; readonly reason: string; readonly facts?: Partial<IntentFacts> }
  /** Park for a human. The runner will not touch it again unaided. */
  | { readonly kind: 'MANUAL'; readonly reason: string; readonly facts?: Partial<IntentFacts> };

export interface StepContext<TServices> {
  readonly intent: Intent;
  readonly facts: IntentFacts;
  readonly services: TServices;
  readonly logger: Logger;
  /** Deterministic reference for this step's outbound call. */
  readonly clientRef: string;
}

export interface Step<TServices> {
  readonly name: string;

  /**
   * Recover an attempt that was in flight when we died.
   *
   * Implementations query the counterparty for `ctx.clientRef` and return the
   * result that attempt would have produced. Returning null means "I could not
   * determine what happened", which parks the intent.
   *
   * A step with a side effect that moves money **must** implement this.
   */
  resolve?(context: StepContext<TServices>): Promise<StepResult | null>;

  run(context: StepContext<TServices>): Promise<StepResult>;

  /** Undo this step's effect. Runs in reverse order during an unwind. */
  compensate?(context: StepContext<TServices>): Promise<void>;
}

export interface Saga<TServices> {
  readonly kind: IntentKind;
  readonly steps: readonly Step<TServices>[];
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

export interface RunnerPolicy {
  /** Give up retrying a step after this many attempts and park it. */
  readonly maxAttempts: number;
  readonly baseBackoffMillis: number;
  readonly maxBackoffMillis: number;
  /** How long to wait before re-polling a step that returned WAIT. */
  readonly waitPollMillis: number;
  /** How long a claimed intent stays leased to this worker. */
  readonly leaseMillis: number;
  readonly batchSize: number;
}

/** Sentinel for a stage name the current saga does not contain. */
const UNKNOWN_STAGE = -1;

export const defaultRunnerPolicy: RunnerPolicy = {
  maxAttempts: 8,
  baseBackoffMillis: 500,
  maxBackoffMillis: 5 * 60 * 1000,
  waitPollMillis: 15 * 1000,
  leaseMillis: 60 * 1000,
  batchSize: 25,
};

export interface RunnerOptions<TServices> {
  readonly sagas: readonly Saga<TServices>[];
  readonly services: TServices;
  readonly store: Store;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly policy?: RunnerPolicy;
  readonly idSource?: IdSource;
}

export interface TickResult {
  readonly claimed: number;
  readonly advanced: number;
  readonly waiting: number;
  readonly completed: number;
  readonly parked: number;
  readonly failed: number;
}

export class SagaRunner<TServices> {
  private readonly sagas = new Map<IntentKind, Saga<TServices>>();
  private readonly services: TServices;
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly policy: RunnerPolicy;
  private readonly idSource: IdSource;

  constructor(options: RunnerOptions<TServices>) {
    for (const saga of options.sagas) this.sagas.set(saga.kind, saga);
    this.services = options.services;
    this.store = options.store;
    this.clock = options.clock;
    this.logger = options.logger;
    this.policy = options.policy ?? defaultRunnerPolicy;
    this.idSource = options.idSource ?? systemIdSource;
  }

  /** Claim a batch of due intents and drive each as far as it will go. */
  async tick(): Promise<TickResult> {
    const claimed = await this.store.intents.claimDue(
      this.clock.nowIso(),
      this.policy.batchSize,
      this.policy.leaseMillis,
    );

    const result = { claimed: claimed.length, advanced: 0, waiting: 0, completed: 0, parked: 0, failed: 0 };

    for (const intent of claimed) {
      try {
        const outcome = await this.drive(intent);
        if (outcome === 'COMPLETED') result.completed += 1;
        else if (outcome === 'WAITING') result.waiting += 1;
        else if (outcome === 'NEEDS_MANUAL') result.parked += 1;
        else result.advanced += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.error(
          { intentId: intent.id, error: describeError(error) },
          'Runner failed to drive intent',
        );
      } finally {
        await this.store.intents.releaseLease(intent.id);
      }
    }

    return result;
  }

  /**
   * Drive one intent as far as it can go in a single pass.
   *
   * Loops through ADVANCE results so a chain of local steps completes in one
   * tick, and stops the moment the intent needs to wait, unwind or park.
   */
  async drive(start: Intent): Promise<IntentState> {
    let intent = start;

    if (intent.state === 'UNWINDING') {
      return (await this.unwind(intent)).state;
    }

    const saga = this.sagas.get(intent.kind);
    if (!saga) {
      intent = await this.park(intent, `No saga registered for kind ${intent.kind}`);
      return intent.state;
    }

    if (intent.state === 'PENDING') {
      intent = await this.persist(intent, { state: 'RUNNING' });
    }

    // Bound the loop: a saga can never take more passes than it has steps.
    for (let guard = 0; guard <= saga.steps.length; guard += 1) {
      const index = this.cursorFor(saga, intent.stage);

      if (index === UNKNOWN_STAGE) {
        // The saga changed under a live intent. Treating an unrecognised stage
        // as "past the end" would mark it COMPLETED without running the steps
        // that actually move the money.
        intent = await this.park(
          intent,
          `Intent stopped at step "${intent.stage}", which no longer exists in the ` +
            `${intent.kind} saga. Its remaining work cannot be inferred and must be ` +
            `resolved by hand.`,
        );
        return intent.state;
      }

      if (index >= saga.steps.length) {
        intent = await this.persist(intent, { state: 'COMPLETED', nextAttemptAt: null });
        this.logger.info({ intentId: intent.id, kind: intent.kind }, 'Intent completed');
        return intent.state;
      }

      const step = saga.steps[index]!;
      const outcome = await this.runStep(intent, step);
      intent = outcome.intent;

      if (outcome.stop) return intent.state;
      if (isTerminal(intent.state)) return intent.state;
    }

    return intent.state;
  }

  /**
   * Index of the next step to run, given the last completed step name.
   * Returns `UNKNOWN_STAGE` when the stage is not part of this saga.
   */
  private cursorFor(saga: Saga<TServices>, stage: string): number {
    if (stage === '') return 0;
    const index = saga.steps.findIndex((step) => step.name === stage);
    if (index === -1) return UNKNOWN_STAGE;
    return index + 1;
  }

  private async runStep(
    intent: Intent,
    step: Step<TServices>,
  ): Promise<{ intent: Intent; stop: boolean }> {
    const context: StepContext<TServices> = {
      intent,
      facts: intent.facts,
      services: this.services,
      logger: this.logger.child({ intentId: intent.id, step: step.name }),
      clientRef: makeClientRef(intent.id, step.name),
    };

    // An attempt with no recorded outcome means we died mid-effect. Resolve it
    // against the counterparty before doing anything else.
    const inFlight = await this.findInFlightAttempt(intent.id, step.name);
    if (inFlight) {
      return this.recoverInFlight(intent, step, context, inFlight);
    }

    const attemptNumber = (intent.attempts[step.name] ?? 0) + 1;
    const attempt = await this.beginAttempt(intent, step.name, attemptNumber, context.clientRef);

    let result: StepResult;
    try {
      result = await step.run(context);
    } catch (error) {
      return this.handleStepError(intent, step, context, attempt, error, attemptNumber);
    }

    await this.finishAttempt(attempt.id, result.kind === 'ADVANCE' ? 'OK' : mapOutcome(result.kind));
    return this.applyResult(intent, step, result, attemptNumber);
  }

  private async recoverInFlight(
    intent: Intent,
    step: Step<TServices>,
    context: StepContext<TServices>,
    attempt: StepAttempt,
  ): Promise<{ intent: Intent; stop: boolean }> {
    this.logger.warn(
      { intentId: intent.id, step: step.name, attemptId: attempt.id },
      'Found an in-flight attempt; resolving against the counterparty',
    );

    if (!step.resolve) {
      await this.finishAttempt(attempt.id, 'AMBIGUOUS');
      const parked = await this.park(
        intent,
        `Step ${step.name} was interrupted and defines no resolver. ` +
          `Its effect must be confirmed manually before this intent can continue.`,
      );
      return { intent: parked, stop: true };
    }

    let resolved: StepResult | null;
    try {
      resolved = await step.resolve(context);
    } catch (error) {
      await this.finishAttempt(attempt.id, 'AMBIGUOUS', this.toErrorRecord(step.name, error));
      const parked = await this.park(
        intent,
        `Resolver for ${step.name} failed: ${describeError(error).message}`,
      );
      return { intent: parked, stop: true };
    }

    if (!resolved) {
      await this.finishAttempt(attempt.id, 'AMBIGUOUS');
      const parked = await this.park(
        intent,
        `Could not determine the outcome of ${step.name} for reference ${context.clientRef}. ` +
          `Confirm with the counterparty before resuming.`,
      );
      return { intent: parked, stop: true };
    }

    await this.finishAttempt(attempt.id, resolved.kind === 'ADVANCE' ? 'OK' : mapOutcome(resolved.kind));
    return this.applyResult(intent, step, resolved, attempt.attempt);
  }

  private async handleStepError(
    intent: Intent,
    step: Step<TServices>,
    context: StepContext<TServices>,
    attempt: StepAttempt,
    error: unknown,
    attemptNumber: number,
  ): Promise<{ intent: Intent; stop: boolean }> {
    const disposition = dispositionOf(error);
    const record = this.toErrorRecord(step.name, error);

    if (disposition === 'AMBIGUOUS') {
      // The effect may have happened. Resolving is the only safe move.
      await this.finishAttempt(attempt.id, 'AMBIGUOUS', record);
      if (step.resolve) {
        try {
          const resolved = await step.resolve(context);
          if (resolved) {
            this.logger.info(
              { intentId: intent.id, step: step.name },
              'Resolved an ambiguous outcome from the counterparty',
            );
            return this.applyResult(intent, step, resolved, attemptNumber);
          }
        } catch (resolveError) {
          this.logger.error(
            { intentId: intent.id, step: step.name, error: describeError(resolveError) },
            'Resolver threw while recovering an ambiguous outcome',
          );
        }
      }
      const parked = await this.park(
        intent,
        `${step.name} returned an indeterminate outcome (${record.message}) and could not be ` +
          `resolved. Reference: ${context.clientRef}`,
        record,
      );
      return { intent: parked, stop: true };
    }

    if (disposition === 'TERMINAL') {
      await this.finishAttempt(attempt.id, 'TERMINAL', record);
      const unwinding = await this.persist(intent, {
        state: 'UNWINDING',
        lastError: record,
        nextAttemptAt: this.clock.nowIso(),
      });
      this.logger.warn(
        { intentId: intent.id, step: step.name, error: record },
        'Step failed terminally; unwinding',
      );
      return { intent: unwinding, stop: true };
    }

    // RETRY
    await this.finishAttempt(attempt.id, 'RETRY', record);
    const attempts = { ...intent.attempts, [step.name]: attemptNumber };

    if (attemptNumber >= this.policy.maxAttempts) {
      const parked = await this.park(
        intent,
        `${step.name} failed ${attemptNumber} times; last error: ${record.message}`,
        record,
        attempts,
      );
      return { intent: parked, stop: true };
    }

    const backoff = Math.min(
      this.policy.baseBackoffMillis * 2 ** (attemptNumber - 1),
      this.policy.maxBackoffMillis,
    );
    const next = await this.persist(intent, {
      attempts,
      lastError: record,
      nextAttemptAt: new Date(this.clock.nowMillis() + backoff).toISOString(),
    });
    this.logger.info(
      { intentId: intent.id, step: step.name, attempt: attemptNumber, backoff },
      'Step failed; will retry',
    );
    return { intent: next, stop: true };
  }

  private async applyResult(
    intent: Intent,
    step: Step<TServices>,
    result: StepResult,
    attemptNumber: number,
  ): Promise<{ intent: Intent; stop: boolean }> {
    const facts = { ...intent.facts, ...(result.facts ?? {}) };
    const attempts = { ...intent.attempts, [step.name]: attemptNumber };

    switch (result.kind) {
      case 'ADVANCE': {
        const next = await this.persist(intent, {
          state: 'RUNNING',
          stage: step.name,
          facts,
          attempts,
          lastError: null,
          nextAttemptAt: null,
        });
        return { intent: next, stop: false };
      }

      case 'WAIT': {
        const delay = result.retryAfterMillis ?? this.policy.waitPollMillis;
        const next = await this.persist(intent, {
          state: 'WAITING',
          facts,
          attempts,
          nextAttemptAt: new Date(this.clock.nowMillis() + delay).toISOString(),
        });
        this.logger.debug(
          { intentId: intent.id, step: step.name, reason: result.reason },
          'Step is waiting on an external event',
        );
        return { intent: next, stop: true };
      }

      case 'UNWIND': {
        const next = await this.persist(intent, {
          state: 'UNWINDING',
          facts,
          attempts,
          lastError: {
            code: 'step_requested_unwind',
            message: result.reason,
            disposition: 'TERMINAL',
            step: step.name,
            at: this.clock.nowIso(),
          },
          nextAttemptAt: this.clock.nowIso(),
        });
        return { intent: next, stop: true };
      }

      case 'MANUAL': {
        const next = await this.park(intent, result.reason, null, attempts, facts);
        return { intent: next, stop: true };
      }
    }
  }

  /* ---- Unwinding ------------------------------------------------------- */

  /**
   * Run compensations in reverse over the steps that completed, then cancel.
   *
   * A compensation that throws parks the intent rather than continuing: a
   * half-unwound intent with money in an unknown place is precisely the
   * situation a human needs to see.
   */
  async unwind(start: Intent): Promise<Intent> {
    let intent = start;
    const saga = this.sagas.get(intent.kind);
    if (!saga) return this.park(intent, `No saga registered for kind ${intent.kind}`);

    const cursor = this.cursorFor(saga, intent.stage);
    if (cursor === UNKNOWN_STAGE) {
      return this.park(
        intent,
        `Cannot unwind: step "${intent.stage}" is not part of the ${intent.kind} saga, so ` +
          `there is no way to know which compensations are owed.`,
      );
    }
    const toCompensate = saga.steps.slice(0, Math.max(cursor, 0)).reverse();

    for (const step of toCompensate) {
      if (!step.compensate) continue;

      const context: StepContext<TServices> = {
        intent,
        facts: intent.facts,
        services: this.services,
        logger: this.logger.child({ intentId: intent.id, step: step.name, phase: 'compensate' }),
        // The *same* reference the step used going forward. A compensation acts
        // on the operation the step created, so it must be able to find it. A
        // compensation that issues a genuinely new outbound operation — a
        // reversal payment, say — derives its own reference from this one.
        clientRef: makeClientRef(intent.id, step.name),
      };

      try {
        await step.compensate(context);
        this.logger.info({ intentId: intent.id, step: step.name }, 'Compensated step');
      } catch (error) {
        const record = this.toErrorRecord(`${step.name}.compensate`, error);
        this.logger.error(
          { intentId: intent.id, step: step.name, error: record },
          'Compensation failed; parking the intent',
        );
        return this.park(
          intent,
          `Compensation for ${step.name} failed: ${record.message}. ` +
            `Funds or positions may be in an intermediate state.`,
          record,
        );
      }
    }

    intent = await this.persist(intent, { state: 'CANCELLED', nextAttemptAt: null });
    this.logger.info({ intentId: intent.id }, 'Intent unwound and cancelled');
    return intent;
  }

  /* ---- Persistence helpers --------------------------------------------- */

  private async persist(intent: Intent, patch: Partial<Intent>): Promise<Intent> {
    if (patch.state && patch.state !== intent.state) {
      assertTransition(intent.state, patch.state);
    }
    return this.store.intents.save({ ...intent, ...patch }, intent.version);
  }

  private async park(
    intent: Intent,
    reason: string,
    error: IntentErrorRecord | null = null,
    attempts?: Record<string, number>,
    facts?: IntentFacts,
  ): Promise<Intent> {
    this.logger.warn({ intentId: intent.id, reason }, 'Intent parked for manual review');
    return this.persist(intent, {
      state: 'NEEDS_MANUAL',
      manualReason: reason,
      lastError: error ?? intent.lastError,
      nextAttemptAt: null,
      ...(attempts ? { attempts } : {}),
      ...(facts ? { facts } : {}),
    });
  }

  private async beginAttempt(
    intent: Intent,
    step: string,
    attempt: number,
    clientRef: string,
  ): Promise<StepAttempt> {
    return this.store.attempts.begin({
      id: newId('evt', this.idSource),
      intentId: intent.id,
      step,
      attempt,
      clientRef,
      startedAt: this.clock.nowIso(),
      finishedAt: null,
      outcome: null,
      error: null,
    });
  }

  private async finishAttempt(
    id: string,
    outcome: StepAttempt['outcome'],
    error: IntentErrorRecord | null = null,
  ): Promise<void> {
    await this.store.attempts.finish(id, {
      outcome,
      error,
      finishedAt: this.clock.nowIso(),
    });
  }

  private async findInFlightAttempt(intentId: string, step: string): Promise<StepAttempt | null> {
    const attempts = await this.store.attempts.listForIntent(intentId);
    return attempts.find((a) => a.step === step && a.finishedAt === null) ?? null;
  }

  private toErrorRecord(step: string, error: unknown): IntentErrorRecord {
    const described = describeError(error);
    return {
      code: String(described.code ?? 'unknown'),
      message: String(described.message ?? 'Unknown error'),
      disposition: dispositionOf(error),
      step,
      at: this.clock.nowIso(),
      context: (described.context as Record<string, unknown>) ?? undefined,
    };
  }
}

function mapOutcome(kind: StepResult['kind']): StepAttempt['outcome'] {
  switch (kind) {
    case 'ADVANCE':
      return 'OK';
    case 'WAIT':
      return 'WAIT';
    case 'UNWIND':
      return 'TERMINAL';
    case 'MANUAL':
      return 'AMBIGUOUS';
  }
}
