/**
 * Mock money services provider.
 *
 * Deterministic and manually stepped: conversions and payouts stay PENDING
 * until a test (or the demo script) advances them. That is what makes the
 * WAIT branches of the sagas testable rather than timing-dependent.
 *
 * Idempotency is enforced the way a real provider's is — keyed on `clientRef`
 * — so a saga that double-creates fails here rather than in production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../domain/clock.js';
import { CounterpartyRejection } from '../../domain/errors.js';
import { convert, fxRate, basisPoints, zero, type Currency, type Money } from '../../domain/money.js';
import type {
  Conversion,
  ConversionQuote,
  CreateConversionRequest,
  CreatePayoutRequest,
  DepositInstructions,
  MoneyServicesProvider,
  MsbBalance,
  MsbStatementLine,
  Payout,
} from '../../ports/msb.js';
import type { CounterpartyEvent, RawWebhook, WebhookVerification } from '../../ports/webhook.js';

/** Indicative mid rates. A real provider quotes these; we fix them for tests. */
const DEFAULT_RATES: Record<string, string> = {
  'USDC->HKD': '7.8100',
  'USDT->HKD': '7.8100',
  'HKD->USDC': '0.1280',
  'HKD->USDT': '0.1280',
  'USDC->USD': '1.0000',
  'USD->HKD': '7.8000',
};

export interface MockMsbOptions {
  readonly clock: Clock;
  readonly webhookSecret: string;
  /** Provider fee in basis points, taken from the source amount. */
  readonly feeBps?: number;
  /** Settle conversions and payouts on creation instead of on demand. */
  readonly autoSettle?: boolean;
  readonly rates?: Record<string, string>;
}

export class MockMsb implements MoneyServicesProvider {
  readonly id = 'mock-msb';

  private readonly conversions = new Map<string, Conversion>();
  private readonly payouts = new Map<string, Payout>();
  private readonly statement: MsbStatementLine[] = [];
  private readonly balances = new Map<Currency, bigint>();
  private sequence = 0;

  /** Set to fail the next create call, to exercise the unwind paths. */
  failNextConversion: string | null = null;
  failNextPayout: string | null = null;

  /**
   * Called when a bank payout settles. `bootstrap` points this at the mock
   * broker so a wire out of here becomes buying power over there — otherwise
   * the two simulations disagree about cash and reconciliation flags it.
   */
  onBankPayoutSettled: ((payout: Payout) => void) | null = null;

  constructor(private readonly options: MockMsbOptions) {}

  private get feeBps(): number {
    return this.options.feeBps ?? 10;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(8, '0')}`;
  }

  private rateFor(from: Currency, to: Currency) {
    const table = { ...DEFAULT_RATES, ...(this.options.rates ?? {}) };
    const decimal = table[`${from}->${to}`];
    if (!decimal) {
      throw new CounterpartyRejection('mock-msb', `No rate for ${from}->${to}`);
    }
    return fxRate(from, to, decimal);
  }

  async getDepositInstructions(currency: Currency): Promise<DepositInstructions> {
    return {
      currency,
      address:
        currency === 'USDC' || currency === 'USDT'
          ? 'MockMsbSo1anaAddress1111111111111111111111111'
          : 'MOCK-MSB-HKD-ACCOUNT',
      mint: currency === 'USDC' ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : undefined,
      memo: 'MARCO-OMNIBUS',
    };
  }

  async quoteConversion(from: Money, to: Currency): Promise<ConversionQuote> {
    const rate = this.rateFor(from.currency, to);
    const fee = basisPoints(from, this.feeBps, 'UP');
    const net: Money = { currency: from.currency, amount: from.amount - fee.amount };
    return {
      quoteId: this.nextId('quo'),
      rate,
      from,
      to: convert(net, rate, 'DOWN'),
      fee,
      expiresAt: new Date(this.options.clock.nowMillis() + 60_000).toISOString(),
    };
  }

  async createConversion(request: CreateConversionRequest): Promise<Conversion> {
    const existing = this.conversions.get(request.clientRef);
    if (existing) return existing;

    if (this.failNextConversion) {
      const reason = this.failNextConversion;
      this.failNextConversion = null;
      const failed: Conversion = {
        id: this.nextId('cnv'),
        clientRef: request.clientRef,
        status: 'FAILED',
        from: request.from,
        to: null,
        rate: null,
        fee: null,
        purpose: request.purpose,
        createdAt: this.options.clock.nowIso(),
        settledAt: null,
        failureReason: reason,
      };
      this.conversions.set(request.clientRef, failed);
      return failed;
    }

    const quote = await this.quoteConversion(request.from, request.to);
    const conversion: Conversion = {
      id: this.nextId('cnv'),
      clientRef: request.clientRef,
      status: 'PENDING',
      from: request.from,
      to: null,
      rate: null,
      fee: null,
      purpose: request.purpose,
      createdAt: this.options.clock.nowIso(),
      settledAt: null,
      failureReason: null,
    };
    this.conversions.set(request.clientRef, conversion);

    // Creating a conversion means the provider already holds the source funds —
    // they arrived on-chain or by wire before we asked for the crossing. Credit
    // them now so the balance reconciles against our MSB-transit account.
    this.credit(
      request.from.currency,
      request.from.amount,
      `Received for conversion ${conversion.id}`,
      request.clientRef,
    );

    if (this.options.autoSettle) {
      return this.settleConversion(request.clientRef);
    }
    void quote;
    return conversion;
  }

  async getConversion(clientRefOrId: string): Promise<Conversion | null> {
    const byRef = this.conversions.get(clientRefOrId);
    if (byRef) return byRef;
    for (const conversion of this.conversions.values()) {
      if (conversion.id === clientRefOrId) return conversion;
    }
    return null;
  }

  /** Test hook: move a pending conversion to SETTLED at the quoted rate. */
  async settleConversion(clientRef: string): Promise<Conversion> {
    const conversion = this.conversions.get(clientRef);
    if (!conversion) throw new CounterpartyRejection('mock-msb', `Unknown conversion ${clientRef}`);
    if (conversion.status === 'SETTLED') return conversion;

    const rate = this.rateFor(conversion.from.currency, this.targetOf(conversion));
    const fee = basisPoints(conversion.from, this.feeBps, 'UP');
    const net: Money = { currency: conversion.from.currency, amount: conversion.from.amount - fee.amount };
    const settled: Conversion = {
      ...conversion,
      status: 'SETTLED',
      rate,
      fee,
      to: convert(net, rate, 'DOWN'),
      settledAt: this.options.clock.nowIso(),
    };
    this.conversions.set(clientRef, settled);
    this.credit(settled.to!.currency, settled.to!.amount, `Conversion ${settled.id}`, clientRef);
    this.debit(settled.from.currency, settled.from.amount, `Conversion ${settled.id}`, clientRef);
    return settled;
  }

  /**
   * The target currency is not stored on the pending record, mirroring
   * providers that only echo it once the rate is fixed. Derived from the
   * available rate table.
   */
  private targetOf(conversion: Conversion): Currency {
    return conversion.from.currency === 'HKD' ? 'USDC' : 'HKD';
  }

  async createPayout(request: CreatePayoutRequest): Promise<Payout> {
    const existing = this.payouts.get(request.clientRef);
    if (existing) return existing;

    if (this.failNextPayout) {
      const reason = this.failNextPayout;
      this.failNextPayout = null;
      const failed: Payout = {
        id: this.nextId('pay'),
        clientRef: request.clientRef,
        status: 'FAILED',
        amount: request.amount,
        fee: null,
        destination: request.destination,
        purpose: request.purpose,
        railReference: null,
        createdAt: this.options.clock.nowIso(),
        settledAt: null,
        failureReason: reason,
      };
      this.payouts.set(request.clientRef, failed);
      return failed;
    }

    const payout: Payout = {
      id: this.nextId('pay'),
      clientRef: request.clientRef,
      status: 'PENDING',
      amount: request.amount,
      fee: zero(request.amount.currency),
      destination: request.destination,
      purpose: request.purpose,
      railReference: null,
      createdAt: this.options.clock.nowIso(),
      settledAt: null,
      failureReason: null,
    };
    this.payouts.set(request.clientRef, payout);

    if (this.options.autoSettle) return this.settlePayout(request.clientRef);
    return payout;
  }

  async getPayout(clientRefOrId: string): Promise<Payout | null> {
    const byRef = this.payouts.get(clientRefOrId);
    if (byRef) return byRef;
    for (const payout of this.payouts.values()) {
      if (payout.id === clientRefOrId) return payout;
    }
    return null;
  }

  /** Test hook: move a pending payout to SETTLED. */
  async settlePayout(clientRef: string): Promise<Payout> {
    const payout = this.payouts.get(clientRef);
    if (!payout) throw new CounterpartyRejection('mock-msb', `Unknown payout ${clientRef}`);
    if (payout.status === 'SETTLED') return payout;

    const settled: Payout = {
      ...payout,
      status: 'SETTLED',
      railReference: `MOCKWIRE${this.nextId('')}`,
      settledAt: this.options.clock.nowIso(),
    };
    this.payouts.set(clientRef, settled);
    this.debit(settled.amount.currency, settled.amount.amount, `Payout ${settled.id}`, clientRef);
    if (settled.destination.rail === 'BANK') this.onBankPayoutSettled?.(settled);
    return settled;
  }

  async getBalances(): Promise<MsbBalance[]> {
    return [...this.balances.entries()].map(([currency, amount]) => ({
      currency,
      available: { currency, amount },
      pending: zero(currency),
    }));
  }

  async listStatement(from: string, to: string): Promise<MsbStatementLine[]> {
    return this.statement.filter((line) => line.postedAt >= from && line.postedAt <= to);
  }

  private credit(currency: Currency, amount: bigint, description: string, clientRef: string): void {
    this.balances.set(currency, (this.balances.get(currency) ?? 0n) + amount);
    this.statement.push({
      id: this.nextId('stm'),
      postedAt: this.options.clock.nowIso(),
      currency,
      amount: { currency, amount },
      description,
      clientRef,
      relatedId: null,
    });
  }

  private debit(currency: Currency, amount: bigint, description: string, clientRef: string): void {
    this.balances.set(currency, (this.balances.get(currency) ?? 0n) - amount);
    this.statement.push({
      id: this.nextId('stm'),
      postedAt: this.options.clock.nowIso(),
      currency,
      amount: { currency, amount: -amount },
      description,
      clientRef,
      relatedId: null,
    });
  }

  /* ---- Webhooks -------------------------------------------------------- */

  /**
   * Stripe-style scheme: HMAC-SHA256 over `${timestamp}.${body}`.
   *
   * The timestamp is inside the signed payload specifically so an attacker
   * cannot replay an old delivery with a fresh header.
   */
  verifyWebhook(raw: RawWebhook): WebhookVerification {
    const signature = headerValue(raw, 'x-msb-signature');
    const timestamp = headerValue(raw, 'x-msb-timestamp');
    const deliveryId = headerValue(raw, 'x-msb-delivery');

    if (!signature || !timestamp) {
      return { valid: false, reason: 'Missing signature or timestamp header' };
    }

    const expected = createHmac('sha256', this.options.webhookSecret)
      .update(`${timestamp}.${raw.body.toString('utf8')}`)
      .digest('hex');

    const provided = Buffer.from(signature, 'utf8');
    const computed = Buffer.from(expected, 'utf8');
    if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
      return { valid: false, reason: 'Signature mismatch' };
    }

    return {
      valid: true,
      deliveryId: deliveryId ?? undefined,
      signedAt: new Date(Number(timestamp) * 1000).toISOString(),
    };
  }

  parseWebhook(raw: RawWebhook): CounterpartyEvent[] {
    const payload = JSON.parse(raw.body.toString('utf8')) as {
      id?: string;
      type?: string;
      clientRef?: string;
      providerId?: string;
      occurredAt?: string;
      data?: unknown;
    };
    return [
      {
        source: 'msb',
        kind: payload.type ?? 'unknown',
        deliveryId: payload.id ?? headerValue(raw, 'x-msb-delivery') ?? 'unknown',
        occurredAt: payload.occurredAt ?? raw.receivedAt,
        clientRef: payload.clientRef,
        providerId: payload.providerId,
        data: payload.data ?? {},
      },
    ];
  }

  /** Build a correctly signed webhook, so tests exercise the real verifier. */
  signWebhook(payload: unknown, timestampSeconds: number): RawWebhook {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = createHmac('sha256', this.options.webhookSecret)
      .update(`${timestampSeconds}.${body.toString('utf8')}`)
      .digest('hex');
    return {
      body,
      headers: {
        'x-msb-signature': signature,
        'x-msb-timestamp': String(timestampSeconds),
        'x-msb-delivery': `dlv_${timestampSeconds}`,
      },
      receivedAt: this.options.clock.nowIso(),
    };
  }

  /** Seed a starting balance, e.g. an initial treasury funding. */
  seedBalance(currency: Currency, amount: bigint): void {
    this.balances.set(currency, amount);
  }
}

export function headerValue(raw: RawWebhook, name: string): string | null {
  const value = raw.headers[name] ?? raw.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
