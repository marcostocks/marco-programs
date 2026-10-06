/**
 * Treasury — the hybrid funding model.
 *
 * Marco keeps a working HKD balance with the broker so an order executes the
 * moment it is screened, rather than waiting a day or two for a USDC→HKD
 * crossing to land. The customer's USDC is already locked in the on-chain
 * escrow when we draw on that buffer, and the program can only ever release it
 * to the immutable conversion-partner account — so the buffer draw is
 * collateralised by an on-chain position we control the timing of, not by
 * hope. That is what makes pre-funding safe here.
 *
 * When the buffer cannot cover an order we fall back to just-in-time: deploy
 * the escrow first, wait for the conversion and the wire, then place. Slower,
 * but it never blocks and it never overdraws.
 *
 * A reservation is a memo, not a movement. Nothing is posted to the ledger when
 * capital is reserved — cash has not moved. Available balance is the ledger
 * balance less the outstanding holds.
 */

import type { Clock } from '../domain/clock.js';
import { InsufficientBufferError, ValidationError } from '../domain/errors.js';
import { newId, type IdSource, systemIdSource } from '../domain/ids.js';
import {
  add,
  compare,
  greaterThan,
  isPositive,
  money,
  subtract,
  sum,
  zero,
  type Currency,
  type Money,
} from '../domain/money.js';
import { CASH_ACCOUNTS } from '../ledger/accounts.js';
import type { Ledger } from '../ledger/ledger.js';
import type { ReservationRepository, Reservation } from '../ports/store.js';

export interface CurrencyPolicy {
  /** Balance we aim to hold. Top-ups target this. */
  readonly target: Money;
  /** Below this, a top-up is triggered. */
  readonly minimum: Money;
  /** Granularity of a top-up, so we are not wiring odd amounts all day. */
  readonly increment: Money;
  /** A single intent may never reserve more than this. */
  readonly maxSingleReservation: Money;
}

export interface TreasuryPolicy {
  /** HKD held with the broker to execute against. */
  readonly hkd: CurrencyPolicy;
  /** USDC held to pay sellers before repatriation lands. */
  readonly usdc: CurrencyPolicy;
  /** How long a hold survives before the sweeper releases it. */
  readonly reservationTtlSeconds: number;
}

/** Which ledger account backs the buffer for a given currency. */
const BUFFER_ACCOUNT = {
  HKD: CASH_ACCOUNTS.BROKER_BUFFER,
  USDC: CASH_ACCOUNTS.TREASURY_USDC,
} as const;

type BufferCurrency = keyof typeof BUFFER_ACCOUNT;

function isBufferCurrency(currency: Currency): currency is BufferCurrency {
  return currency === 'HKD' || currency === 'USDC';
}

export interface BufferSnapshot {
  readonly currency: Currency;
  /** What the ledger says we hold. */
  readonly balance: Money;
  /** Committed to intents that have not consumed it yet. */
  readonly held: Money;
  /** balance − held. What a new reservation can draw on. */
  readonly available: Money;
  readonly target: Money;
  readonly minimum: Money;
  readonly healthy: boolean;
}

export interface TopUpPlan {
  readonly currency: Currency;
  /** How much to add, rounded up to the policy increment. */
  readonly amount: Money;
  readonly reason: string;
}

export interface TreasuryOptions {
  readonly ledger: Ledger;
  readonly reservations: ReservationRepository;
  readonly policy: TreasuryPolicy;
  readonly clock: Clock;
  readonly idSource?: IdSource;
}

export class Treasury {
  private readonly ledger: Ledger;
  private readonly reservations: ReservationRepository;
  private readonly policy: TreasuryPolicy;
  private readonly clock: Clock;
  private readonly idSource: IdSource;

  constructor(options: TreasuryOptions) {
    this.ledger = options.ledger;
    this.reservations = options.reservations;
    this.policy = options.policy;
    this.clock = options.clock;
    this.idSource = options.idSource ?? systemIdSource;
  }

  private policyFor(currency: Currency): CurrencyPolicy {
    if (!isBufferCurrency(currency)) {
      throw new ValidationError(`No treasury buffer is maintained in ${currency}`, { currency });
    }
    return currency === 'HKD' ? this.policy.hkd : this.policy.usdc;
  }

  private accountFor(currency: Currency) {
    if (!isBufferCurrency(currency)) {
      throw new ValidationError(`No treasury buffer is maintained in ${currency}`, { currency });
    }
    return BUFFER_ACCOUNT[currency];
  }

  /* ---- Reads ----------------------------------------------------------- */

  async snapshot(currency: Currency): Promise<BufferSnapshot> {
    const policy = this.policyFor(currency);
    const balance = this.ledger.balance(this.accountFor(currency), currency);
    const held = await this.heldTotal(currency);
    const available = subtract(balance, held);

    return {
      currency,
      balance,
      held,
      available,
      target: policy.target,
      minimum: policy.minimum,
      healthy: compare(available, policy.minimum) >= 0,
    };
  }

  async heldTotal(currency: Currency): Promise<Money> {
    const held = await this.reservations.listHeld(currency);
    return sum(
      currency,
      held.map((reservation) => reservation.amount),
    );
  }

  async available(currency: Currency): Promise<Money> {
    return (await this.snapshot(currency)).available;
  }

  /* ---- Reservations ---------------------------------------------------- */

  /**
   * Hold buffer capital against an intent.
   *
   * Throws `InsufficientBufferError` rather than queueing, because the caller
   * has a genuine alternative — the just-in-time path — and silently waiting
   * would leave a trader's order unplaced with no explanation.
   *
   * Reserving twice for the same intent returns the existing hold, so a retry
   * after a crash does not double-commit the buffer.
   */
  async reserve(intentId: string, amount: Money): Promise<Reservation> {
    if (!isPositive(amount)) {
      throw new ValidationError('Reservation amount must be positive', {
        intentId,
        amount: amount.amount.toString(),
      });
    }

    const existing = await this.reservations.findByIntent(intentId);
    if (existing && existing.state === 'HELD') return existing;

    const policy = this.policyFor(amount.currency);
    if (greaterThan(amount, policy.maxSingleReservation)) {
      throw new InsufficientBufferError(
        `Reservation of ${amount.amount} ${amount.currency} exceeds the per-intent ceiling`,
        {
          intentId,
          requested: amount.amount.toString(),
          ceiling: policy.maxSingleReservation.amount.toString(),
        },
      );
    }

    const snapshot = await this.snapshot(amount.currency);
    if (greaterThan(amount, snapshot.available)) {
      throw new InsufficientBufferError(
        `Buffer has ${snapshot.available.amount} ${amount.currency} available, ` +
          `${amount.amount} requested`,
        {
          intentId,
          available: snapshot.available.amount.toString(),
          requested: amount.amount.toString(),
        },
      );
    }

    const now = this.clock.nowMillis();
    return this.reservations.create({
      id: newId('res', this.idSource),
      intentId,
      currency: amount.currency,
      amount,
      state: 'HELD',
      createdAt: new Date(now).toISOString(),
      resolvedAt: null,
      expiresAt: new Date(now + this.policy.reservationTtlSeconds * 1000).toISOString(),
      version: 1,
    });
  }

  /** The capital was actually spent. The ledger posting is the caller's job. */
  async consume(reservationId: string): Promise<Reservation> {
    const reservation = await this.requireReservation(reservationId);
    if (reservation.state === 'CONSUMED') return reservation;
    if (reservation.state !== 'HELD') {
      throw new ValidationError(`Cannot consume a ${reservation.state} reservation`, {
        reservationId,
      });
    }
    return this.reservations.save(
      { ...reservation, state: 'CONSUMED', resolvedAt: this.clock.nowIso() },
      reservation.version,
    );
  }

  /** The intent unwound. Give the capacity back. */
  async release(reservationId: string): Promise<Reservation> {
    const reservation = await this.requireReservation(reservationId);
    if (reservation.state === 'RELEASED') return reservation;
    if (reservation.state !== 'HELD') {
      throw new ValidationError(`Cannot release a ${reservation.state} reservation`, {
        reservationId,
      });
    }
    return this.reservations.save(
      { ...reservation, state: 'RELEASED', resolvedAt: this.clock.nowIso() },
      reservation.version,
    );
  }

  private async requireReservation(id: string): Promise<Reservation> {
    const reservation = await this.reservations.get(id);
    if (!reservation) {
      throw new ValidationError(`Reservation ${id} not found`, { reservationId: id });
    }
    return reservation;
  }

  /**
   * Release holds whose intents died without resolving them.
   *
   * Returns the freed reservations so the caller can alarm on them: an expired
   * hold always means an intent stalled somewhere, and the buffer capacity
   * being returned is a symptom, not the problem.
   */
  async sweepExpired(): Promise<Reservation[]> {
    const expired = await this.reservations.listExpired(this.clock.nowIso());
    const swept: Reservation[] = [];
    for (const reservation of expired) {
      swept.push(
        await this.reservations.save(
          { ...reservation, state: 'EXPIRED', resolvedAt: this.clock.nowIso() },
          reservation.version,
        ),
      );
    }
    return swept;
  }

  /* ---- Top-ups --------------------------------------------------------- */

  /**
   * How much to add to bring the buffer back to target, rounded up to the
   * policy increment. Returns null when the buffer is healthy.
   */
  async assessTopUp(currency: Currency): Promise<TopUpPlan | null> {
    const snapshot = await this.snapshot(currency);
    if (snapshot.healthy) return null;

    const policy = this.policyFor(currency);
    const shortfall = subtract(policy.target, snapshot.available);
    if (!isPositive(shortfall)) return null;

    const increment = policy.increment.amount;
    const rounded =
      increment > 0n
        ? ((shortfall.amount + increment - 1n) / increment) * increment
        : shortfall.amount;

    return {
      currency,
      amount: money(currency, rounded),
      reason:
        `Available ${snapshot.available.amount} is below the ${policy.minimum.amount} ` +
        `minimum; topping up to the ${policy.target.amount} target`,
    };
  }

  /** Every buffer that needs attention, for the ops dashboard and alerting. */
  async assessAll(): Promise<{ snapshots: BufferSnapshot[]; plans: TopUpPlan[] }> {
    const currencies: Currency[] = ['HKD', 'USDC'];
    const snapshots: BufferSnapshot[] = [];
    const plans: TopUpPlan[] = [];
    for (const currency of currencies) {
      snapshots.push(await this.snapshot(currency));
      const plan = await this.assessTopUp(currency);
      if (plan) plans.push(plan);
    }
    return { snapshots, plans };
  }

  /**
   * Can the buffer fund this order right now?
   *
   * Answering before reserving lets the saga choose its funding path without
   * relying on an exception for control flow.
   */
  async canFund(amount: Money): Promise<boolean> {
    if (!isBufferCurrency(amount.currency)) return false;
    const policy = this.policyFor(amount.currency);
    if (greaterThan(amount, policy.maxSingleReservation)) return false;
    const snapshot = await this.snapshot(amount.currency);
    return compare(amount, snapshot.available) <= 0;
  }
}

/* -------------------------------------------------------------------------- */

export function defaultTreasuryPolicy(overrides: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return {
    hkd: {
      target: money('HKD', 500_000_00n),
      minimum: money('HKD', 150_000_00n),
      increment: money('HKD', 250_000_00n),
      maxSingleReservation: money('HKD', 1_000_000_00n),
    },
    usdc: {
      target: money('USDC', 500_000_000_000n),
      minimum: money('USDC', 150_000_000_000n),
      increment: money('USDC', 250_000_000_000n),
      maxSingleReservation: money('USDC', 250_000_000_000n),
    },
    reservationTtlSeconds: 6 * 60 * 60,
    ...overrides,
  };
}

/** Sum a set of buffer snapshots into a single health verdict. */
export function bufferHealth(snapshots: readonly BufferSnapshot[]): {
  healthy: boolean;
  degraded: Currency[];
} {
  const degraded = snapshots.filter((s) => !s.healthy).map((s) => s.currency);
  return { healthy: degraded.length === 0, degraded };
}

/** Total exposure across buffers, for the ops view. */
export function totalHeld(snapshots: readonly BufferSnapshot[], currency: Currency): Money {
  const matching = snapshots.filter((s) => s.currency === currency);
  return matching.length === 0
    ? zero(currency)
    : matching.reduce((acc, s) => add(acc, s.held), zero(currency));
}
