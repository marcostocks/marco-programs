/**
 * Error taxonomy.
 *
 * The runner decides what to do with a failed step purely from the error's
 * class, so the distinction between these three is the most important design
 * decision in the service:
 *
 *   RetryableError  — the effect definitely did not happen. Retry is safe.
 *   TerminalError   — the effect definitely did not happen and never will.
 *                     Fail the step and unwind.
 *   AmbiguousError  — we do not know whether the effect happened. Never retry.
 *                     Resolve by querying the counterparty for our
 *                     deterministic clientRef, or park for a human.
 *
 * A timeout on "wire HKD 4,000,000 to the broker" is ambiguous, not retryable.
 * Treating it as retryable is how money gets sent twice.
 */

export type ErrorDisposition = 'RETRY' | 'TERMINAL' | 'AMBIGUOUS';

export interface OrchestratorErrorOptions {
  code: string;
  message: string;
  /** Free-form, safe to log. Never put credentials or PII here. */
  context?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class OrchestratorError extends Error {
  abstract readonly disposition: ErrorDisposition;
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(options: OrchestratorErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = options.code;
    this.context = options.context ?? {};
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      disposition: this.disposition,
      context: this.context,
    };
  }
}

/** The effect did not happen. Safe to retry with the same clientRef. */
export class RetryableError extends OrchestratorError {
  override readonly name: string = 'RetryableError';
  readonly disposition = 'RETRY' as const;
}

/** The effect did not happen and cannot succeed. Unwind. */
export class TerminalError extends OrchestratorError {
  override readonly name: string = 'TerminalError';
  readonly disposition = 'TERMINAL' as const;
}

/**
 * We do not know whether the effect happened.
 *
 * The runner will attempt exactly one recovery path: ask the counterparty what
 * it knows about our deterministic reference. If that is inconclusive the
 * intent parks in NEEDS_MANUAL and stops. It never guesses.
 */
export class AmbiguousError extends OrchestratorError {
  override readonly name: string = 'AmbiguousError';
  readonly disposition = 'AMBIGUOUS' as const;
}

/* -------------------------------------------------------------------------- */
/* Specific failures                                                           */
/* -------------------------------------------------------------------------- */

export class ValidationError extends TerminalError {
  override readonly name = 'ValidationError';
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: 'validation_failed', message, context });
  }
}

export class NotFoundError extends TerminalError {
  override readonly name = 'NotFoundError';
  constructor(kind: string, id: string) {
    super({ code: 'not_found', message: `${kind} ${id} not found`, context: { kind, id } });
  }
}

export class ConflictError extends TerminalError {
  override readonly name = 'ConflictError';
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: 'conflict', message, context });
  }
}

/** An attempted state machine transition that the transition table forbids. */
export class IllegalTransitionError extends TerminalError {
  override readonly name = 'IllegalTransitionError';
  constructor(from: string, to: string, entity: string) {
    super({
      code: 'illegal_transition',
      message: `${entity}: ${from} → ${to} is not a permitted transition`,
      context: { from, to, entity },
    });
  }
}

/** The ledger refused an unbalanced or invalid posting. Always a code defect. */
export class LedgerError extends TerminalError {
  override readonly name = 'LedgerError';
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: 'ledger_invariant_violated', message, context });
  }
}

/** Screening blocked the subject, or eligibility is absent or revoked. */
export class ComplianceError extends TerminalError {
  override readonly name = 'ComplianceError';
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: 'compliance_blocked', message, context });
  }
}

/** Not enough uncommitted buffer to reserve against. Callers fall back to JIT. */
export class InsufficientBufferError extends TerminalError {
  override readonly name = 'InsufficientBufferError';
  constructor(message: string, context?: Record<string, unknown>) {
    super({ code: 'insufficient_buffer', message, context });
  }
}

/** A counterparty returned a well-formed rejection. */
export class CounterpartyRejection extends TerminalError {
  override readonly name = 'CounterpartyRejection';
  constructor(counterparty: string, reason: string, context?: Record<string, unknown>) {
    super({
      code: 'counterparty_rejected',
      message: `${counterparty} rejected the request: ${reason}`,
      context: { counterparty, reason, ...context },
    });
  }
}

/** A counterparty was unreachable or returned 5xx before doing any work. */
export class CounterpartyUnavailable extends RetryableError {
  override readonly name = 'CounterpartyUnavailable';
  constructor(counterparty: string, reason: string, context?: Record<string, unknown>) {
    super({
      code: 'counterparty_unavailable',
      message: `${counterparty} is unavailable: ${reason}`,
      context: { counterparty, reason, ...context },
    });
  }
}

/**
 * A request timed out or the connection dropped mid-flight. We cannot tell
 * whether the counterparty acted on it.
 */
export class CounterpartyIndeterminate extends AmbiguousError {
  override readonly name = 'CounterpartyIndeterminate';
  constructor(counterparty: string, reason: string, context?: Record<string, unknown>) {
    super({
      code: 'counterparty_indeterminate',
      message: `${counterparty} outcome is unknown: ${reason}`,
      context: { counterparty, reason, ...context },
    });
  }
}

/**
 * A transaction was submitted to Solana but not observed as confirmed.
 * It may still land. Resolve by reading on-chain state, never by resubmitting
 * blind.
 */
export class ChainSubmissionIndeterminate extends AmbiguousError {
  override readonly name = 'ChainSubmissionIndeterminate';
  constructor(instruction: string, reason: string, context?: Record<string, unknown>) {
    super({
      code: 'chain_indeterminate',
      message: `${instruction} may or may not have confirmed: ${reason}`,
      context: { instruction, reason, ...context },
    });
  }
}

export class WebhookVerificationError extends TerminalError {
  override readonly name = 'WebhookVerificationError';
  constructor(reason: string, context?: Record<string, unknown>) {
    super({ code: 'webhook_verification_failed', message: reason, context });
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function dispositionOf(error: unknown): ErrorDisposition {
  if (error instanceof OrchestratorError) return error.disposition;
  // An unclassified throw from inside an adapter could be anything. Treat it as
  // ambiguous: refusing to guess is the whole point of this taxonomy.
  return 'AMBIGUOUS';
}

export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof OrchestratorError) return error.toJSON();
  if (error instanceof Error) {
    return { name: error.name, message: error.message, disposition: 'AMBIGUOUS' };
  }
  return { name: 'UnknownError', message: String(error), disposition: 'AMBIGUOUS' };
}
