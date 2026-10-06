/**
 * In-memory store.
 *
 * Correct for a single process: it enforces the same optimistic-concurrency and
 * leasing semantics the Postgres implementation must, so a saga that is correct
 * against this one stays correct against that one. It is not durable, so it is
 * for development and tests only.
 */

import type { Clock } from '../../domain/clock.js';
import { NotFoundError } from '../../domain/errors.js';
import type { Currency } from '../../domain/money.js';
import type { Intent, StepAttempt } from '../../orchestration/intent.js';
import type { VaultMandate } from '../../orchestration/vault-mandate.js';
import type { ChainCursor } from '../../ports/chain.js';
import {
  OptimisticLockError,
  type Account,
  type AccountRepository,
  type BreakRepository,
  type BreakStatus,
  type BreakKind,
  type BreakSeverity,
  type CursorRepository,
  type IntentFilter,
  type IntentRepository,
  type ProcessedEvent,
  type ProcessedEventRepository,
  type ReconBreak,
  type Reservation,
  type ReservationRepository,
  type StepAttemptRepository,
  type Store,
  type VaultMandateRepository,
} from '../../ports/store.js';

/** Deep-freeze-ish clone so callers cannot mutate stored state by reference. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

class MemoryAccountRepository implements AccountRepository {
  private readonly rows = new Map<string, Account>();
  constructor(private readonly clock: Clock) {}

  async get(wallet: string): Promise<Account | null> {
    const row = this.rows.get(wallet);
    return row ? clone(row) : null;
  }

  async list(filter: { status?: Account['status']; limit?: number } = {}): Promise<Account[]> {
    let rows = [...this.rows.values()];
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.limit !== undefined) rows = rows.slice(0, filter.limit);
    return rows.map(clone);
  }

  async create(
    account: Omit<Account, 'version' | 'createdAt' | 'updatedAt'>,
  ): Promise<Account> {
    if (this.rows.has(account.wallet)) {
      throw new OptimisticLockError('Account', account.wallet, 0, 1);
    }
    const now = this.clock.nowIso();
    const row: Account = { ...account, createdAt: now, updatedAt: now, version: 1 };
    this.rows.set(row.wallet, clone(row));
    return clone(row);
  }

  async save(account: Account, expectedVersion: number): Promise<Account> {
    const existing = this.rows.get(account.wallet);
    if (!existing) throw new NotFoundError('Account', account.wallet);
    if (existing.version !== expectedVersion) {
      throw new OptimisticLockError('Account', account.wallet, expectedVersion, existing.version);
    }
    const row: Account = {
      ...account,
      updatedAt: this.clock.nowIso(),
      version: existing.version + 1,
    };
    this.rows.set(row.wallet, clone(row));
    return clone(row);
  }
}

class MemoryIntentRepository implements IntentRepository {
  private readonly rows = new Map<string, Intent>();
  private readonly leases = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  async get(id: string): Promise<Intent | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async findBySourceSignature(signature: string): Promise<Intent | null> {
    for (const row of this.rows.values()) {
      if (row.source.signature === signature) return clone(row);
    }
    return null;
  }

  async list(filter: IntentFilter = {}): Promise<Intent[]> {
    let rows = [...this.rows.values()];
    if (filter.wallet) rows = rows.filter((r) => r.wallet === filter.wallet);
    if (filter.kind) rows = rows.filter((r) => r.kind === filter.kind);
    if (filter.state) {
      const states = Array.isArray(filter.state) ? filter.state : [filter.state];
      rows = rows.filter((r) => states.includes(r.state));
    }
    if (filter.ticker) rows = rows.filter((r) => r.request.ticker === filter.ticker);
    if (filter.vaultId) rows = rows.filter((r) => r.request.vaultId === filter.vaultId);
    if (filter.since) rows = rows.filter((r) => r.createdAt >= filter.since!);
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (filter.limit !== undefined) rows = rows.slice(0, filter.limit);
    return rows.map(clone);
  }

  async create(intent: Intent): Promise<Intent> {
    if (this.rows.has(intent.id)) {
      throw new OptimisticLockError('Intent', intent.id, 0, intent.version);
    }
    this.rows.set(intent.id, clone(intent));
    return clone(intent);
  }

  async save(intent: Intent, expectedVersion: number): Promise<Intent> {
    const existing = this.rows.get(intent.id);
    if (!existing) throw new NotFoundError('Intent', intent.id);
    if (existing.version !== expectedVersion) {
      throw new OptimisticLockError('Intent', intent.id, expectedVersion, existing.version);
    }
    const row: Intent = {
      ...intent,
      updatedAt: this.clock.nowIso(),
      version: existing.version + 1,
    };
    this.rows.set(row.id, clone(row));
    return clone(row);
  }

  async claimDue(now: string, limit: number, leaseMillis: number): Promise<Intent[]> {
    const nowMillis = new Date(now).getTime();
    const claimed: Intent[] = [];

    // UNWINDING must be claimable: compensations run on a later tick than the
    // failure that triggered them, and omitting it here strands the intent
    // mid-unwind with money in an intermediate place.
    const claimable: Intent['state'][] = ['PENDING', 'RUNNING', 'WAITING', 'UNWINDING'];
    const candidates = [...this.rows.values()]
      .filter((row) => claimable.includes(row.state))
      .filter((row) => row.nextAttemptAt === null || row.nextAttemptAt <= now)
      .filter((row) => (this.leases.get(row.id) ?? 0) <= nowMillis)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const candidate of candidates) {
      if (claimed.length >= limit) break;
      this.leases.set(candidate.id, nowMillis + leaseMillis);
      claimed.push(clone(candidate));
    }
    return claimed;
  }

  async releaseLease(id: string): Promise<void> {
    this.leases.delete(id);
  }
}

class MemoryStepAttemptRepository implements StepAttemptRepository {
  private readonly rows = new Map<string, StepAttempt>();

  async begin(attempt: StepAttempt): Promise<StepAttempt> {
    this.rows.set(attempt.id, clone(attempt));
    return clone(attempt);
  }

  async finish(
    id: string,
    patch: Pick<StepAttempt, 'outcome' | 'error' | 'finishedAt'>,
  ): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) throw new NotFoundError('StepAttempt', id);
    this.rows.set(id, clone({ ...existing, ...patch }));
  }

  async listForIntent(intentId: string): Promise<StepAttempt[]> {
    return [...this.rows.values()]
      .filter((row) => row.intentId === intentId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map(clone);
  }

  async listInFlight(): Promise<StepAttempt[]> {
    return [...this.rows.values()].filter((row) => row.finishedAt === null).map(clone);
  }
}

class MemoryReservationRepository implements ReservationRepository {
  private readonly rows = new Map<string, Reservation>();

  async get(id: string): Promise<Reservation | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async findByIntent(intentId: string): Promise<Reservation | null> {
    for (const row of this.rows.values()) {
      if (row.intentId === intentId) return clone(row);
    }
    return null;
  }

  async listHeld(currency: Currency): Promise<Reservation[]> {
    return [...this.rows.values()]
      .filter((row) => row.state === 'HELD' && row.currency === currency)
      .map(clone);
  }

  async listExpired(now: string): Promise<Reservation[]> {
    return [...this.rows.values()]
      .filter((row) => row.state === 'HELD' && row.expiresAt <= now)
      .map(clone);
  }

  async create(reservation: Reservation): Promise<Reservation> {
    if (this.rows.has(reservation.id)) {
      throw new OptimisticLockError('Reservation', reservation.id, 0, reservation.version);
    }
    this.rows.set(reservation.id, clone(reservation));
    return clone(reservation);
  }

  async save(reservation: Reservation, expectedVersion: number): Promise<Reservation> {
    const existing = this.rows.get(reservation.id);
    if (!existing) throw new NotFoundError('Reservation', reservation.id);
    if (existing.version !== expectedVersion) {
      throw new OptimisticLockError(
        'Reservation',
        reservation.id,
        expectedVersion,
        existing.version,
      );
    }
    const row: Reservation = { ...reservation, version: existing.version + 1 };
    this.rows.set(row.id, clone(row));
    return clone(row);
  }
}

class MemoryVaultMandateRepository implements VaultMandateRepository {
  private readonly rows = new Map<string, VaultMandate>();
  private readonly leases = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  async get(id: string): Promise<VaultMandate | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async findByVaultId(vaultId: string): Promise<VaultMandate | null> {
    for (const row of this.rows.values()) {
      if (row.vaultId === vaultId) return clone(row);
    }
    return null;
  }

  async list(filter: { state?: string; limit?: number } = {}): Promise<VaultMandate[]> {
    let rows = [...this.rows.values()];
    if (filter.state) rows = rows.filter((r) => r.state === filter.state);
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (filter.limit !== undefined) rows = rows.slice(0, filter.limit);
    return rows.map(clone);
  }

  async create(mandate: VaultMandate): Promise<VaultMandate> {
    if (this.rows.has(mandate.id)) {
      throw new OptimisticLockError('VaultMandate', mandate.id, 0, mandate.version);
    }
    this.rows.set(mandate.id, clone(mandate));
    return clone(mandate);
  }

  async save(mandate: VaultMandate, expectedVersion: number): Promise<VaultMandate> {
    const existing = this.rows.get(mandate.id);
    if (!existing) throw new NotFoundError('VaultMandate', mandate.id);
    if (existing.version !== expectedVersion) {
      throw new OptimisticLockError('VaultMandate', mandate.id, expectedVersion, existing.version);
    }
    const row: VaultMandate = {
      ...mandate,
      updatedAt: this.clock.nowIso(),
      version: existing.version + 1,
    };
    this.rows.set(row.id, clone(row));
    return clone(row);
  }

  async claimDue(now: string, limit: number, leaseMillis: number): Promise<VaultMandate[]> {
    const nowMillis = new Date(now).getTime();
    const claimed: VaultMandate[] = [];
    const candidates = [...this.rows.values()]
      .filter((row) => row.state === 'ACTIVE')
      .filter((row) => row.nextAttemptAt === null || row.nextAttemptAt <= now)
      .filter((row) => (this.leases.get(row.id) ?? 0) <= nowMillis)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const candidate of candidates) {
      if (claimed.length >= limit) break;
      this.leases.set(candidate.id, nowMillis + leaseMillis);
      claimed.push(clone(candidate));
    }
    return claimed;
  }
}

class MemoryProcessedEventRepository implements ProcessedEventRepository {
  private readonly rows = new Map<string, ProcessedEvent>();

  async claim(event: ProcessedEvent): Promise<boolean> {
    if (this.rows.has(event.key)) return false;
    this.rows.set(event.key, clone(event));
    return true;
  }

  async has(key: string): Promise<boolean> {
    return this.rows.has(key);
  }

  async purgeBefore(cutoff: string): Promise<number> {
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (row.receivedAt < cutoff) {
        this.rows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryBreakRepository implements BreakRepository {
  private readonly rows = new Map<string, ReconBreak>();

  async get(id: string): Promise<ReconBreak | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async list(
    filter: { status?: BreakStatus; severity?: BreakSeverity; limit?: number } = {},
  ): Promise<ReconBreak[]> {
    let rows = [...this.rows.values()];
    if (filter.status) rows = rows.filter((r) => r.status === filter.status);
    if (filter.severity) rows = rows.filter((r) => r.severity === filter.severity);
    rows.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
    if (filter.limit !== undefined) rows = rows.slice(0, filter.limit);
    return rows.map(clone);
  }

  async findOpenByScope(kind: BreakKind, scope: string): Promise<ReconBreak | null> {
    for (const row of this.rows.values()) {
      if (row.kind === kind && row.scope === scope && row.status !== 'RESOLVED') {
        return clone(row);
      }
    }
    return null;
  }

  async create(item: ReconBreak): Promise<ReconBreak> {
    this.rows.set(item.id, clone(item));
    return clone(item);
  }

  async save(item: ReconBreak, expectedVersion: number): Promise<ReconBreak> {
    const existing = this.rows.get(item.id);
    if (!existing) throw new NotFoundError('ReconBreak', item.id);
    if (existing.version !== expectedVersion) {
      throw new OptimisticLockError('ReconBreak', item.id, expectedVersion, existing.version);
    }
    const row: ReconBreak = { ...item, version: existing.version + 1 };
    this.rows.set(row.id, clone(row));
    return clone(row);
  }
}

class MemoryCursorRepository implements CursorRepository {
  private readonly rows = new Map<string, ChainCursor>();

  async get(name: string): Promise<ChainCursor | null> {
    const row = this.rows.get(name);
    return row ? clone(row) : null;
  }

  async set(name: string, cursor: ChainCursor): Promise<void> {
    this.rows.set(name, clone(cursor));
  }
}

export class MemoryStore implements Store {
  readonly accounts: AccountRepository;
  readonly intents: IntentRepository;
  readonly attempts: StepAttemptRepository;
  readonly reservations: ReservationRepository;
  readonly mandates: VaultMandateRepository;
  readonly processedEvents: ProcessedEventRepository;
  readonly breaks: BreakRepository;
  readonly cursors: CursorRepository;

  constructor(clock: Clock) {
    this.accounts = new MemoryAccountRepository(clock);
    this.intents = new MemoryIntentRepository(clock);
    this.attempts = new MemoryStepAttemptRepository();
    this.reservations = new MemoryReservationRepository();
    this.mandates = new MemoryVaultMandateRepository(clock);
    this.processedEvents = new MemoryProcessedEventRepository();
    this.breaks = new MemoryBreakRepository();
    this.cursors = new MemoryCursorRepository();
  }
}
