/**
 * Double-entry ledger.
 *
 * Two books share one journal: cash (money) and positions (share units). Both
 * enforce the same rule — every entry sums to zero, cash per currency and
 * positions per ticker. An unbalanced entry is rejected, not corrected.
 *
 * This is the source of truth for what Marco believes. Reconciliation compares
 * it against what Solana says and what the counterparties say; a disagreement
 * between the three is a break, and breaks are never auto-resolved.
 */

import type { Clock } from '../domain/clock.js';
import { LedgerError } from '../domain/errors.js';
import { newId, type IdSource, systemIdSource } from '../domain/ids.js';
import {
  CURRENCIES,
  type Currency,
  type Money,
  type Quantity,
  money,
  quantity,
} from '../domain/money.js';
import type { CashAccount, PositionAccount } from './accounts.js';

export interface CashPosting {
  readonly account: CashAccount;
  readonly currency: Currency;
  /** Signed minor units. Debit positive, credit negative. */
  readonly amount: bigint;
}

export interface PositionPosting {
  readonly account: PositionAccount;
  readonly ticker: string;
  /** Signed share units. Debit positive, credit negative. */
  readonly units: bigint;
}

export interface JournalEntryInput {
  /** The intent, vault mandate or treasury operation this entry belongs to. */
  readonly intentId?: string;
  /** The state transition or operation that produced it, e.g. 'broker.filled'. */
  readonly reference: string;
  readonly memo: string;
  readonly cash?: readonly CashPosting[];
  readonly positions?: readonly PositionPosting[];
  /** Free-form, safe to log. */
  readonly metadata?: Record<string, unknown>;
}

export interface JournalEntry extends JournalEntryInput {
  readonly id: string;
  readonly at: string;
  readonly sequence: number;
  readonly cash: readonly CashPosting[];
  readonly positions: readonly PositionPosting[];
}

export interface JournalFilter {
  intentId?: string;
  reference?: string;
  since?: string;
  until?: string;
  limit?: number;
}

/**
 * Append-only journal persistence. The in-memory implementation is fine for
 * development and tests; production points this at Postgres, where `append`
 * must run in the same transaction as the state change that caused it.
 */
export interface JournalStore {
  append(entry: JournalEntry): Promise<void>;
  list(filter?: JournalFilter): Promise<JournalEntry[]>;
  nextSequence(): Promise<number>;
}

export class InMemoryJournalStore implements JournalStore {
  private readonly entries: JournalEntry[] = [];

  async append(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
  }

  async list(filter: JournalFilter = {}): Promise<JournalEntry[]> {
    let result = this.entries;
    if (filter.intentId) result = result.filter((e) => e.intentId === filter.intentId);
    if (filter.reference) result = result.filter((e) => e.reference === filter.reference);
    if (filter.since) result = result.filter((e) => e.at >= filter.since!);
    if (filter.until) result = result.filter((e) => e.at <= filter.until!);
    if (filter.limit !== undefined) result = result.slice(-filter.limit);
    return [...result];
  }

  async nextSequence(): Promise<number> {
    return this.entries.length + 1;
  }
}

/* -------------------------------------------------------------------------- */

type BalanceKey = string;

const cashKey = (account: string, currency: string): BalanceKey => `${account}|${currency}`;
const positionKey = (account: string, ticker: string): BalanceKey => `${account}|${ticker}`;

export interface LedgerOptions {
  store?: JournalStore;
  clock: Clock;
  idSource?: IdSource;
}

export class Ledger {
  private readonly store: JournalStore;
  private readonly clock: Clock;
  private readonly idSource: IdSource;

  /** Materialised balances. Rebuilt from the journal by `load()`. */
  private readonly cashBalances = new Map<BalanceKey, bigint>();
  private readonly positionBalances = new Map<BalanceKey, bigint>();

  constructor(options: LedgerOptions) {
    this.store = options.store ?? new InMemoryJournalStore();
    this.clock = options.clock;
    this.idSource = options.idSource ?? systemIdSource;
  }

  /** Replay the journal to rebuild balances. Run at startup. */
  async load(): Promise<void> {
    this.cashBalances.clear();
    this.positionBalances.clear();
    for (const entry of await this.store.list()) {
      this.applyToBalances(entry);
    }
  }

  /**
   * Validate and append an entry.
   *
   * Rejects rather than repairs: an unbalanced entry means the calling saga has
   * a defect, and silently plugging it would put a wrong number in the book
   * that reconciliation would later report as a counterparty break.
   */
  async post(input: JournalEntryInput): Promise<JournalEntry> {
    const cash = (input.cash ?? []).filter((posting) => posting.amount !== 0n);
    const positions = (input.positions ?? []).filter((posting) => posting.units !== 0n);

    if (cash.length === 0 && positions.length === 0) {
      throw new LedgerError('Journal entry has no non-zero postings', {
        reference: input.reference,
      });
    }

    this.assertCashBalanced(cash, input.reference);
    this.assertPositionsBalanced(positions, input.reference);

    const entry: JournalEntry = {
      ...input,
      id: newId('jrn', this.idSource),
      at: this.clock.nowIso(),
      sequence: await this.store.nextSequence(),
      cash,
      positions,
    };

    await this.store.append(entry);
    this.applyToBalances(entry);
    return entry;
  }

  private assertCashBalanced(postings: readonly CashPosting[], reference: string): void {
    const totals = new Map<Currency, bigint>();
    for (const posting of postings) {
      totals.set(posting.currency, (totals.get(posting.currency) ?? 0n) + posting.amount);
    }
    for (const [currency, total] of totals) {
      if (total !== 0n) {
        throw new LedgerError(
          `Cash postings for ${reference} do not balance in ${currency}: net ${total}`,
          {
            reference,
            currency,
            net: total.toString(),
            postings: postings.map((p) => ({
              account: p.account,
              currency: p.currency,
              amount: p.amount.toString(),
            })),
          },
        );
      }
    }
  }

  private assertPositionsBalanced(
    postings: readonly PositionPosting[],
    reference: string,
  ): void {
    const totals = new Map<string, bigint>();
    for (const posting of postings) {
      totals.set(posting.ticker, (totals.get(posting.ticker) ?? 0n) + posting.units);
    }
    for (const [ticker, total] of totals) {
      if (total !== 0n) {
        throw new LedgerError(
          `Position postings for ${reference} do not balance in ${ticker}: net ${total}`,
          { reference, ticker, net: total.toString() },
        );
      }
    }
  }

  private applyToBalances(entry: JournalEntry): void {
    for (const posting of entry.cash) {
      const key = cashKey(posting.account, posting.currency);
      this.cashBalances.set(key, (this.cashBalances.get(key) ?? 0n) + posting.amount);
    }
    for (const posting of entry.positions) {
      const key = positionKey(posting.account, posting.ticker);
      this.positionBalances.set(key, (this.positionBalances.get(key) ?? 0n) + posting.units);
    }
  }

  /* ---- Reads ----------------------------------------------------------- */

  balance(account: CashAccount, currency: Currency): Money {
    return money(currency, this.cashBalances.get(cashKey(account, currency)) ?? 0n);
  }

  positionBalance(account: PositionAccount, ticker: string): Quantity {
    const units = this.positionBalances.get(positionKey(account, ticker)) ?? 0n;
    // Quantity forbids negatives by construction; liability accounts are stored
    // credit-negative, so callers read magnitude and interpret the sign from
    // the account type.
    return quantity(ticker, units < 0n ? -units : units);
  }

  signedPositionBalance(account: PositionAccount, ticker: string): bigint {
    return this.positionBalances.get(positionKey(account, ticker)) ?? 0n;
  }

  /** Every account with a non-zero balance in the given currency. */
  balancesByCurrency(currency: Currency): Array<{ account: string; amount: bigint }> {
    const result: Array<{ account: string; amount: bigint }> = [];
    for (const [key, amount] of this.cashBalances) {
      const [account, keyCurrency] = key.split('|');
      if (keyCurrency === currency && amount !== 0n) {
        result.push({ account: account!, amount });
      }
    }
    return result.sort((a, b) => a.account.localeCompare(b.account));
  }

  /** Every ticker with a non-zero position balance. */
  tickersHeld(): string[] {
    const tickers = new Set<string>();
    for (const [key, units] of this.positionBalances) {
      if (units !== 0n) tickers.add(key.split('|')[1]!);
    }
    return [...tickers].sort();
  }

  /**
   * The books balance when every currency and every ticker nets to zero across
   * all accounts. This is a self-check on the ledger itself, not on the
   * counterparties — a non-zero result is always a code defect.
   */
  trialBalance(): { cash: Record<string, string>; positions: Record<string, string> } {
    const cash: Record<string, string> = {};
    for (const currency of CURRENCIES) {
      let total = 0n;
      for (const [key, amount] of this.cashBalances) {
        if (key.endsWith(`|${currency}`)) total += amount;
      }
      if (total !== 0n || this.balancesByCurrency(currency).length > 0) {
        cash[currency] = total.toString();
      }
    }

    const positions: Record<string, string> = {};
    for (const ticker of this.tickersHeld()) {
      let total = 0n;
      for (const [key, units] of this.positionBalances) {
        if (key.endsWith(`|${ticker}`)) total += units;
      }
      positions[ticker] = total.toString();
    }

    return { cash, positions };
  }

  assertBalanced(): void {
    const trial = this.trialBalance();
    for (const [currency, total] of Object.entries(trial.cash)) {
      if (total !== '0') {
        throw new LedgerError(`Trial balance is non-zero for ${currency}: ${total}`, { trial });
      }
    }
    for (const [ticker, total] of Object.entries(trial.positions)) {
      if (total !== '0') {
        throw new LedgerError(`Position trial balance is non-zero for ${ticker}: ${total}`, {
          trial,
        });
      }
    }
  }

  entries(filter?: JournalFilter): Promise<JournalEntry[]> {
    return this.store.list(filter);
  }
}

/* -------------------------------------------------------------------------- */
/* Posting helpers                                                             */
/* -------------------------------------------------------------------------- */

export function debit(account: CashAccount, value: Money): CashPosting {
  return { account, currency: value.currency, amount: value.amount };
}

export function credit(account: CashAccount, value: Money): CashPosting {
  return { account, currency: value.currency, amount: -value.amount };
}

export function debitShares(account: PositionAccount, qty: Quantity): PositionPosting {
  return { account, ticker: qty.ticker, units: qty.units };
}

export function creditShares(account: PositionAccount, qty: Quantity): PositionPosting {
  return { account, ticker: qty.ticker, units: -qty.units };
}

/** Move value between two cash accounts in one currency. */
export function transfer(from: CashAccount, to: CashAccount, value: Money): CashPosting[] {
  return [credit(from, value), debit(to, value)];
}

/** Move share units between two position accounts. */
export function transferShares(
  from: PositionAccount,
  to: PositionAccount,
  qty: Quantity,
): PositionPosting[] {
  return [creditShares(from, qty), debitShares(to, qty)];
}
