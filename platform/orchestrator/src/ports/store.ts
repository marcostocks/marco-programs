/**
 * Persistence ports.
 *
 * Every repository is optimistic-concurrency controlled: a write carries the
 * version it read, and a mismatch throws. Two runner instances working the same
 * intent is not a hypothetical — it is what happens during a rolling deploy —
 * and the failure mode without this is placing an order twice.
 *
 * The in-memory implementation is for development and tests. In production
 * these map to Postgres, where `claimDue` becomes
 * `SELECT … FOR UPDATE SKIP LOCKED` and `JournalStore.append` runs in the same
 * transaction as the state change that produced it.
 */

import type { Currency, Money } from '../domain/money.js';
import type { Intent, IntentKind, IntentState, StepAttempt } from '../orchestration/intent.js';
import type { VaultMandate } from '../orchestration/vault-mandate.js';
import type { ChainCursor } from './chain.js';
import type { VerificationRecord } from './compliance.js';

export class OptimisticLockError extends Error {
  override readonly name = 'OptimisticLockError';
  constructor(entity: string, id: string, expected: number, actual: number) {
    super(`${entity} ${id} changed underneath us (expected v${expected}, found v${actual})`);
  }
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export interface Account {
  readonly wallet: string;
  readonly status: AccountStatus;
  readonly verification: VerificationRecord | null;
  /**
   * Opaque references to the holder's external receiving accounts, registered
   * out of band. Used for vault share-delivery elections. Raw account details
   * never live in this service.
   */
  readonly beneficiaryRefs: Readonly<Record<string, string>>;
  readonly suspendedReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AccountRepository {
  get(wallet: string): Promise<Account | null>;
  list(filter?: { status?: AccountStatus; limit?: number }): Promise<Account[]>;
  save(account: Account, expectedVersion: number): Promise<Account>;
  create(account: Omit<Account, 'version' | 'createdAt' | 'updatedAt'>): Promise<Account>;
}

/* -------------------------------------------------------------------------- */
/* Intents                                                                     */
/* -------------------------------------------------------------------------- */

export interface IntentFilter {
  wallet?: string;
  kind?: IntentKind;
  state?: IntentState | IntentState[];
  ticker?: string;
  vaultId?: string;
  since?: string;
  limit?: number;
}

export interface IntentRepository {
  get(id: string): Promise<Intent | null>;

  /** Look up by the chain signature that created it, to dedupe event replay. */
  findBySourceSignature(signature: string): Promise<Intent | null>;

  list(filter?: IntentFilter): Promise<Intent[]>;

  create(intent: Intent): Promise<Intent>;

  save(intent: Intent, expectedVersion: number): Promise<Intent>;

  /**
   * Atomically claim intents that are due for work, taking a lease so a second
   * worker skips them. Returns claimed intents with their leases already set.
   *
   * Must include `UNWINDING`: compensations run on a later tick than the
   * failure that triggered them.
   */
  claimDue(now: string, limit: number, leaseMillis: number): Promise<Intent[]>;

  /** Release a lease early so another worker can pick the intent up. */
  releaseLease(id: string): Promise<void>;
}

export interface StepAttemptRepository {
  /** Written before the side effect. */
  begin(attempt: StepAttempt): Promise<StepAttempt>;
  finish(id: string, patch: Pick<StepAttempt, 'outcome' | 'error' | 'finishedAt'>): Promise<void>;
  listForIntent(intentId: string): Promise<StepAttempt[]>;
  /** Attempts with no recorded outcome — effects that may be in flight. */
  listInFlight(): Promise<StepAttempt[]>;
}

/* -------------------------------------------------------------------------- */
/* Treasury reservations                                                       */
/* -------------------------------------------------------------------------- */

export type ReservationState = 'HELD' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';

export interface Reservation {
  readonly id: string;
  readonly intentId: string;
  readonly currency: Currency;
  readonly amount: Money;
  readonly state: ReservationState;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  /**
   * A hold from a crashed intent must not lock the buffer forever, so every
   * reservation expires and the sweeper releases it.
   */
  readonly expiresAt: string;
  readonly version: number;
}

export interface ReservationRepository {
  get(id: string): Promise<Reservation | null>;
  findByIntent(intentId: string): Promise<Reservation | null>;
  listHeld(currency: Currency): Promise<Reservation[]>;
  listExpired(now: string): Promise<Reservation[]>;
  create(reservation: Reservation): Promise<Reservation>;
  save(reservation: Reservation, expectedVersion: number): Promise<Reservation>;
}

/* -------------------------------------------------------------------------- */
/* Vault mandates                                                              */
/* -------------------------------------------------------------------------- */

export interface VaultMandateRepository {
  get(id: string): Promise<VaultMandate | null>;
  findByVaultId(vaultId: string): Promise<VaultMandate | null>;
  list(filter?: { state?: string; limit?: number }): Promise<VaultMandate[]>;
  create(mandate: VaultMandate): Promise<VaultMandate>;
  save(mandate: VaultMandate, expectedVersion: number): Promise<VaultMandate>;
  claimDue(now: string, limit: number, leaseMillis: number): Promise<VaultMandate[]>;
}

/* -------------------------------------------------------------------------- */
/* Inbound event dedupe                                                        */
/* -------------------------------------------------------------------------- */

export interface ProcessedEvent {
  readonly key: string;
  readonly source: string;
  readonly receivedAt: string;
  readonly intentId: string | null;
}

export interface ProcessedEventRepository {
  /**
   * Record an event key. Returns false if it was already recorded, which is the
   * signal to drop a redelivery. Counterparties retry aggressively; applying the
   * same fill twice would double a position.
   */
  claim(event: ProcessedEvent): Promise<boolean>;
  has(key: string): Promise<boolean>;
  purgeBefore(cutoff: string): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Reconciliation breaks                                                       */
/* -------------------------------------------------------------------------- */

export type BreakKind = 'CASH' | 'POSITION' | 'ORPHAN' | 'STALE';
export type BreakSeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type BreakStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface ReconBreak {
  readonly id: string;
  readonly runId: string;
  readonly kind: BreakKind;
  readonly severity: BreakSeverity;
  /** Account name, ticker, or reference the break attaches to. */
  readonly scope: string;
  readonly description: string;
  /** Stringified so a bigint survives the round trip. */
  readonly ledgerValue: string | null;
  readonly chainValue: string | null;
  readonly counterpartyValue: string | null;
  readonly delta: string | null;
  readonly relatedIntentIds: readonly string[];
  readonly status: BreakStatus;
  readonly detectedAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: string | null;
  readonly version: number;
}

export interface BreakRepository {
  get(id: string): Promise<ReconBreak | null>;
  list(filter?: { status?: BreakStatus; severity?: BreakSeverity; limit?: number }): Promise<
    ReconBreak[]
  >;
  /** Find an existing open break for the same scope, so runs do not duplicate. */
  findOpenByScope(kind: BreakKind, scope: string): Promise<ReconBreak | null>;
  create(item: ReconBreak): Promise<ReconBreak>;
  save(item: ReconBreak, expectedVersion: number): Promise<ReconBreak>;
}

/* -------------------------------------------------------------------------- */
/* Cursors                                                                     */
/* -------------------------------------------------------------------------- */

export interface CursorRepository {
  get(name: string): Promise<ChainCursor | null>;
  set(name: string, cursor: ChainCursor): Promise<void>;
}

/* -------------------------------------------------------------------------- */

export interface Store {
  readonly accounts: AccountRepository;
  readonly intents: IntentRepository;
  readonly attempts: StepAttemptRepository;
  readonly reservations: ReservationRepository;
  readonly mandates: VaultMandateRepository;
  readonly processedEvents: ProcessedEventRepository;
  readonly breaks: BreakRepository;
  readonly cursors: CursorRepository;
}
