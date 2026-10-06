/**
 * The Intent — the unit of orchestration.
 *
 * One intent is one thing a user asked for: buy this share, sell that one,
 * subscribe to this vault, take delivery of those shares. It is created from an
 * observed on-chain event, never from a bare HTTP call, because the on-chain
 * escrow *is* the authorisation. A trader whose USDC is not locked in the
 * market escrow has not agreed to anything.
 *
 * State is split in two on purpose:
 *
 *   - `state` is coarse and shared across every kind, with a small transition
 *     table that is actually enforceable.
 *   - `stage` is the name of the last completed saga step, which is what makes
 *     an operator able to read a stuck intent and know exactly where it stopped.
 */

import { IllegalTransitionError } from '../domain/errors.js';
import type { Money, Quantity } from '../domain/money.js';

export type IntentKind =
  | 'SPOT_BUY'
  | 'SPOT_SELL'
  | 'VAULT_SUBSCRIBE'
  | 'VAULT_REDEEM'
  | 'VAULT_DELIVERY';

export type IntentState =
  /** Created from a chain event, not yet picked up by the runner. */
  | 'PENDING'
  /** Steps are executing. */
  | 'RUNNING'
  /** Blocked on an external event — a fill, a settlement, a wire landing. */
  | 'WAITING'
  /** Every step done. Terminal. */
  | 'COMPLETED'
  /** Compensating: returning funds or positions to where they started. */
  | 'UNWINDING'
  /** Unwound or rejected before anything moved. Terminal. */
  | 'CANCELLED'
  /**
   * Parked for a human. Reached whenever an outcome is ambiguous, a
   * reconciliation break touches this intent, or retries are exhausted.
   * The runner will not touch it again without an explicit operator action.
   */
  | 'NEEDS_MANUAL';

const TRANSITIONS: Record<IntentState, readonly IntentState[]> = {
  PENDING: ['RUNNING', 'CANCELLED', 'NEEDS_MANUAL'],
  RUNNING: ['RUNNING', 'WAITING', 'COMPLETED', 'UNWINDING', 'NEEDS_MANUAL'],
  WAITING: ['RUNNING', 'WAITING', 'UNWINDING', 'CANCELLED', 'NEEDS_MANUAL'],
  UNWINDING: ['UNWINDING', 'CANCELLED', 'NEEDS_MANUAL'],
  NEEDS_MANUAL: ['RUNNING', 'UNWINDING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const TERMINAL_STATES: readonly IntentState[] = ['COMPLETED', 'CANCELLED'];

export function isTerminal(state: IntentState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: IntentState, to: IntentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: IntentState, to: IntentState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to, 'Intent');
  }
}

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Everything a saga has learned so far. Each step writes the facts it
 * establishes and never rewrites another step's. On a resume the runner reads
 * these to decide what still needs doing.
 */
export interface IntentFacts {
  /* Compliance */
  screeningId?: string;
  screeningDecision?: 'CLEAR' | 'REVIEW' | 'BLOCK';

  /* Treasury */
  reservationId?: string;
  reservedAmount?: Money;
  /** True when the buffer could not cover it and we fell back to just-in-time. */
  justInTime?: boolean;

  /**
   * Shares we actually intend to buy: the request clamped to a whole board lot
   * and to what the trader's escrow can pay for at their limit price. Fixed
   * once, before the order is placed, so a later step cannot silently size up.
   */
  plannedQuantity?: Quantity;

  /* Broker */
  brokerClientOrderId?: string;
  brokerOrderId?: string;
  brokerTradeReference?: string;
  filledQuantity?: Quantity;
  averagePrice?: Money;
  grossConsideration?: Money;
  brokerCommission?: Money;
  brokerLevies?: Money;

  /* MSB */
  conversionRef?: string;
  conversionId?: string;
  convertedAmount?: Money;
  fxRateDecimal?: string;
  payoutRef?: string;
  payoutId?: string;
  msbFee?: Money;

  /* Custodian */
  custodySettlementId?: string;
  custodyReference?: string;
  documentRef?: string;
  documentHash?: string;
  deliveryRef?: string;

  /* Chain */
  deploySignature?: string;
  confirmSignature?: string;
  settleSignature?: string;
  cancelSignature?: string;

  /* Economics realised at completion */
  netProceeds?: Money;
  spreadEarned?: Money;

  /* Vault */
  vaultPhase?: string;
}

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

export interface IntentSource {
  /** Solana signature of the transaction that created the obligation. */
  readonly signature: string;
  readonly slot: number;
  readonly observedAt: string;
}

export interface IntentRequest {
  readonly ticker?: string;
  readonly vaultId?: string;
  /** On-chain order id for spot, or the deposit reference for a vault. */
  readonly orderId?: string;
  /** USDC escrowed (buy) or expected proceeds basis (sell). */
  readonly amount?: Money;
  readonly quantity?: Quantity;
  /** Per-share limit in HKD the trader agreed to on-chain. */
  readonly limitPrice?: Money;
  /** Where a delivery election should send the shares. */
  readonly beneficiaryRef?: string;
}

export interface IntentErrorRecord {
  readonly code: string;
  readonly message: string;
  readonly disposition: 'RETRY' | 'TERMINAL' | 'AMBIGUOUS';
  readonly step: string;
  readonly at: string;
  readonly context?: Record<string, unknown>;
}

export interface Intent {
  readonly id: string;
  readonly kind: IntentKind;
  readonly state: IntentState;
  /** Name of the last completed step. Empty before the first one. */
  readonly stage: string;
  readonly wallet: string;
  readonly source: IntentSource;
  readonly request: IntentRequest;
  readonly facts: IntentFacts;

  /** Per-step attempt counts, used for backoff and the retry ceiling. */
  readonly attempts: Readonly<Record<string, number>>;
  readonly lastError: IntentErrorRecord | null;
  /** Earliest time the runner may pick this up again. */
  readonly nextAttemptAt: string | null;
  /** Why it is parked, when state is NEEDS_MANUAL. */
  readonly manualReason: string | null;

  readonly createdAt: string;
  readonly updatedAt: string;
  /** Optimistic concurrency guard. Every write bumps it. */
  readonly version: number;
}

export type NewIntent = Omit<
  Intent,
  'id' | 'state' | 'stage' | 'facts' | 'attempts' | 'lastError' | 'nextAttemptAt' |
  'manualReason' | 'createdAt' | 'updatedAt' | 'version'
> & {
  readonly facts?: IntentFacts;
};

/* -------------------------------------------------------------------------- */
/* Step journal                                                                */
/* -------------------------------------------------------------------------- */

export type StepOutcome =
  /** Step completed; advance. */
  | 'OK'
  /** Step needs an external event before it can complete. */
  | 'WAIT'
  /** Failed, safe to retry. */
  | 'RETRY'
  /** Failed permanently; unwind. */
  | 'TERMINAL'
  /** Outcome unknown; do not retry. */
  | 'AMBIGUOUS';

/**
 * Write-ahead record of a step attempt.
 *
 * Written **before** the side effect, so a crash mid-flight leaves evidence
 * that an effect may be in progress. Recovery reads these, finds attempts with
 * no terminal outcome, and resolves each by asking the counterparty about the
 * deterministic `clientRef` — it never re-runs the effect on faith.
 */
export interface StepAttempt {
  readonly id: string;
  readonly intentId: string;
  readonly step: string;
  readonly attempt: number;
  readonly clientRef: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: StepOutcome | null;
  readonly error: IntentErrorRecord | null;
}

export function isInFlight(attempt: StepAttempt): boolean {
  return attempt.finishedAt === null;
}
