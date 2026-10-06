/**
 * Mock executing broker.
 *
 * Orders rest until a test fills them, which is what makes `await_fill`'s WAIT
 * branch testable. Board-lot and limit-price rules are enforced the way HKEX
 * enforces them, so a saga that gets those wrong fails here and not in
 * production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../domain/clock.js';
import { CounterpartyRejection } from '../../domain/errors.js';
import { basisPoints, money, notional, zero, type Money, type Quantity } from '../../domain/money.js';
import type {
  BrokerOrder,
  BuyingPower,
  CashStatementLine,
  Execution,
  ExecutingBroker,
  Instrument,
  IpoListing,
  IpoSubscription,
  PlaceIpoSubscriptionRequest,
  PlaceOrderRequest,
} from '../../ports/broker.js';
import type { CounterpartyEvent, RawWebhook, WebhookVerification } from '../../ports/webhook.js';
import { headerValue } from './msb.js';

/** HK commission is typically bps of consideration with a per-order minimum. */
const COMMISSION_BPS = 25;
const MINIMUM_COMMISSION = money('HKD', 100_00n);
/** Stamp duty 0.1%, SFC levy 0.0027%, HKEX trading fee 0.00565%, rounded together. */
const LEVY_BPS = 11;

export interface MockBrokerOptions {
  readonly clock: Clock;
  readonly webhookSecret: string;
  /** Fill orders on placement instead of waiting for `fill()`. */
  readonly autoFill?: boolean;
  readonly accountRef?: string;
}

export class MockBroker implements ExecutingBroker {
  readonly id = 'mock-broker';

  private readonly instruments = new Map<string, Instrument>();
  private readonly orders = new Map<string, BrokerOrder>();
  private readonly listings = new Map<string, IpoListing>();
  private readonly subscriptions = new Map<string, IpoSubscription>();
  private readonly cashStatement: CashStatementLine[] = [];
  private buyingPower: Money = money('HKD', 0n);
  private sequence = 0;

  rejectNextOrder: string | null = null;

  constructor(private readonly options: MockBrokerOptions) {
    this.seedInstrument({
      ticker: '0700.HK',
      name: 'Tencent Holdings',
      exchange: 'HKEX',
      currency: 'HKD',
      lotSize: 100n,
      tickSize: money('HKD', 20n),
      status: 'TRADING',
    });
    this.seedInstrument({
      ticker: '9988.HK',
      name: 'Alibaba Group',
      exchange: 'HKEX',
      currency: 'HKD',
      lotSize: 100n,
      tickSize: money('HKD', 5n),
      status: 'TRADING',
    });
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${String(this.sequence).padStart(8, '0')}`;
  }

  seedInstrument(instrument: Instrument): void {
    this.instruments.set(instrument.ticker, instrument);
  }

  setInstrumentStatus(ticker: string, status: Instrument['status']): void {
    const instrument = this.instruments.get(ticker);
    if (instrument) this.instruments.set(ticker, { ...instrument, status });
  }

  seedBuyingPower(amount: Money): void {
    this.buyingPower = amount;
  }

  /**
   * A wire from the money services provider landed in the settlement account.
   *
   * Wired up in `bootstrap` so a settled bank payout at the MSB shows up as
   * buying power here — without it the two mocks disagree about cash and
   * reconciliation reports a break that only exists because the simulation is
   * incomplete.
   */
  receiveFunds(amount: Money): void {
    if (amount.currency !== 'HKD') return;
    this.buyingPower = { currency: 'HKD', amount: this.buyingPower.amount + amount.amount };
    this.cashStatement.push({
      id: this.nextId('CSH'),
      postedAt: this.options.clock.nowIso(),
      amount,
      description: 'Inbound wire from the money services provider',
      relatedReference: null,
    });
  }

  async getInstrument(ticker: string): Promise<Instrument | null> {
    return this.instruments.get(ticker) ?? null;
  }

  async placeOrder(request: PlaceOrderRequest): Promise<BrokerOrder> {
    const existing = this.orders.get(request.clientOrderId);
    if (existing) return existing;

    const instrument = this.instruments.get(request.ticker);
    const base: BrokerOrder = {
      clientOrderId: request.clientOrderId,
      brokerOrderId: null,
      status: 'PENDING_NEW',
      ticker: request.ticker,
      side: request.side,
      requestedQuantity: request.quantity,
      filledQuantity: { ticker: request.ticker, units: 0n },
      limitPrice: request.limitPrice,
      averagePrice: null,
      grossConsideration: null,
      totalCommission: zero('HKD'),
      totalLevies: zero('HKD'),
      executions: [],
      placedAt: this.options.clock.nowIso(),
      completedAt: null,
      rejectReason: null,
      tradeReference: null,
    };

    const reject = (reason: string): BrokerOrder => {
      const rejected: BrokerOrder = {
        ...base,
        status: 'REJECTED',
        rejectReason: reason,
        completedAt: this.options.clock.nowIso(),
      };
      this.orders.set(request.clientOrderId, rejected);
      return rejected;
    };

    if (this.rejectNextOrder) {
      const reason = this.rejectNextOrder;
      this.rejectNextOrder = null;
      return reject(reason);
    }
    if (!instrument) return reject(`Unknown instrument ${request.ticker}`);
    if (instrument.status !== 'TRADING') return reject(`${request.ticker} is ${instrument.status}`);
    if (request.quantity.units <= 0n) return reject('Quantity must be positive');
    if (request.quantity.units % instrument.lotSize !== 0n) {
      return reject(
        `Quantity ${request.quantity.units} is not a whole multiple of the ${instrument.lotSize}-share board lot`,
      );
    }
    if (request.limitPrice.amount % instrument.tickSize.amount !== 0n) {
      return reject(`Limit price ${request.limitPrice.amount} is not on the ${instrument.tickSize.amount} tick`);
    }

    const accepted: BrokerOrder = {
      ...base,
      status: 'NEW',
      brokerOrderId: this.nextId('BRK'),
    };
    this.orders.set(request.clientOrderId, accepted);

    if (this.options.autoFill) {
      return this.fill(request.clientOrderId, request.quantity.units, request.limitPrice);
    }
    return accepted;
  }

  async getOrder(clientOrderId: string): Promise<BrokerOrder | null> {
    return this.orders.get(clientOrderId) ?? null;
  }

  async cancelOrder(clientOrderId: string): Promise<BrokerOrder> {
    const order = this.orders.get(clientOrderId);
    if (!order) throw new CounterpartyRejection('mock-broker', `Unknown order ${clientOrderId}`);
    if (order.status === 'FILLED') {
      throw new CounterpartyRejection('mock-broker', 'Cannot cancel a filled order');
    }
    const cancelled: BrokerOrder = {
      ...order,
      status: 'CANCELLED',
      completedAt: this.options.clock.nowIso(),
    };
    this.orders.set(clientOrderId, cancelled);
    return cancelled;
  }

  /**
   * Test hook: execute against a resting order.
   *
   * Commission and levies are computed the way a real HK contract note does, so
   * the ledger assertions in tests exercise real arithmetic.
   */
  async fill(clientOrderId: string, units: bigint, price: Money): Promise<BrokerOrder> {
    const order = this.orders.get(clientOrderId);
    if (!order) throw new CounterpartyRejection('mock-broker', `Unknown order ${clientOrderId}`);
    if (order.status === 'FILLED' || order.status === 'CANCELLED' || order.status === 'REJECTED') {
      return order;
    }

    // A broker cannot fill more than was ordered. Enforced here so a saga that
    // mis-sizes an order fails against the mock rather than in production.
    const remaining = order.requestedQuantity.units - order.filledQuantity.units;
    if (units > remaining) {
      throw new CounterpartyRejection(
        'mock-broker',
        `Cannot fill ${units} of ${order.ticker}: only ${remaining} remain on order ${clientOrderId}`,
      );
    }

    const quantity: Quantity = { ticker: order.ticker, units };
    const consideration = notional(quantity, price, 'UP');
    const rawCommission = basisPoints(consideration, COMMISSION_BPS, 'UP');
    const commission =
      rawCommission.amount < MINIMUM_COMMISSION.amount ? MINIMUM_COMMISSION : rawCommission;
    const levies = basisPoints(consideration, LEVY_BPS, 'UP');

    const execution: Execution = {
      executionId: this.nextId('EXE'),
      executedAt: this.options.clock.nowIso(),
      quantity,
      price,
      commission,
      levies,
    };

    const totalUnits = order.filledQuantity.units + units;
    const previousConsideration = order.grossConsideration ?? zero('HKD');
    const totalConsideration: Money = {
      currency: 'HKD',
      amount: previousConsideration.amount + consideration.amount,
    };

    const filled: BrokerOrder = {
      ...order,
      status: totalUnits >= order.requestedQuantity.units ? 'FILLED' : 'PARTIALLY_FILLED',
      filledQuantity: { ticker: order.ticker, units: totalUnits },
      averagePrice: { currency: 'HKD', amount: totalConsideration.amount / totalUnits },
      grossConsideration: totalConsideration,
      totalCommission: { currency: 'HKD', amount: order.totalCommission.amount + commission.amount },
      totalLevies: { currency: 'HKD', amount: order.totalLevies.amount + levies.amount },
      executions: [...order.executions, execution],
      completedAt:
        totalUnits >= order.requestedQuantity.units ? this.options.clock.nowIso() : null,
      tradeReference: order.tradeReference ?? this.nextId('TRD'),
    };

    this.orders.set(clientOrderId, filled);

    // Buying power moves with the trade, the way a real account does: a buy
    // consumes cash plus costs, a sale returns the net proceeds.
    const cashDelta =
      order.side === 'BUY'
        ? -(consideration.amount + commission.amount + levies.amount)
        : consideration.amount - commission.amount - levies.amount;
    this.buyingPower = { currency: 'HKD', amount: this.buyingPower.amount + cashDelta };

    this.cashStatement.push({
      id: this.nextId('CSH'),
      postedAt: this.options.clock.nowIso(),
      amount: {
        currency: 'HKD',
        amount: order.side === 'BUY' ? -consideration.amount : consideration.amount,
      },
      description: `${order.side} ${units} ${order.ticker}`,
      relatedReference: filled.tradeReference,
    });
    return filled;
  }

  async getBuyingPower(accountRef: string): Promise<BuyingPower> {
    return { accountRef, available: this.buyingPower, committed: zero('HKD') };
  }

  async listExecutions(from: string, to: string): Promise<BrokerOrder[]> {
    return [...this.orders.values()].filter(
      (order) => order.placedAt >= from && order.placedAt <= to && order.executions.length > 0,
    );
  }

  async listCashStatement(from: string, to: string): Promise<CashStatementLine[]> {
    return this.cashStatement.filter((line) => line.postedAt >= from && line.postedAt <= to);
  }

  /* ---- IPO ------------------------------------------------------------- */

  seedListing(listing: IpoListing): void {
    this.listings.set(listing.listingId, listing);
  }

  async getIpoListing(listingId: string): Promise<IpoListing | null> {
    return this.listings.get(listingId) ?? null;
  }

  async placeIpoSubscription(request: PlaceIpoSubscriptionRequest): Promise<IpoSubscription> {
    const existing = this.subscriptions.get(request.clientRef);
    if (existing) return existing;

    const listing = this.listings.get(request.listingId);
    const subscription: IpoSubscription = {
      clientRef: request.clientRef,
      brokerRef: listing ? this.nextId('IPO') : null,
      status: listing ? 'SUBMITTED' : 'REJECTED',
      listingId: request.listingId,
      appliedAmount: request.appliedAmount,
      appliedQuantity: request.appliedQuantity,
      allocatedQuantity: null,
      allocatedAmount: null,
      refundAmount: null,
      submittedAt: this.options.clock.nowIso(),
      resolvedAt: null,
      rejectReason: listing ? null : `Unknown listing ${request.listingId}`,
    };
    this.subscriptions.set(request.clientRef, subscription);
    return subscription;
  }

  async getIpoSubscription(clientRef: string): Promise<IpoSubscription | null> {
    return this.subscriptions.get(clientRef) ?? null;
  }

  /** Test hook: the broker accepts the application. */
  async acceptIpo(clientRef: string): Promise<IpoSubscription> {
    const subscription = this.requireSubscription(clientRef);
    const accepted: IpoSubscription = { ...subscription, status: 'ACCEPTED' };
    this.subscriptions.set(clientRef, accepted);
    return accepted;
  }

  /** Test hook: the ballot result. */
  async allocateIpo(
    clientRef: string,
    allocated: Quantity,
    allocatedAmount: Money,
  ): Promise<IpoSubscription> {
    const subscription = this.requireSubscription(clientRef);
    const result: IpoSubscription = {
      ...subscription,
      status: 'ALLOCATED',
      allocatedQuantity: allocated,
      allocatedAmount,
      refundAmount: {
        currency: subscription.appliedAmount.currency,
        amount: subscription.appliedAmount.amount - allocatedAmount.amount,
      },
      resolvedAt: this.options.clock.nowIso(),
    };
    this.subscriptions.set(clientRef, result);
    return result;
  }

  private requireSubscription(clientRef: string): IpoSubscription {
    const subscription = this.subscriptions.get(clientRef);
    if (!subscription) {
      throw new CounterpartyRejection('mock-broker', `Unknown IPO subscription ${clientRef}`);
    }
    return subscription;
  }

  /* ---- Webhooks -------------------------------------------------------- */

  verifyWebhook(raw: RawWebhook): WebhookVerification {
    const signature = headerValue(raw, 'x-broker-signature');
    const timestamp = headerValue(raw, 'x-broker-timestamp');
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
      deliveryId: headerValue(raw, 'x-broker-delivery') ?? undefined,
      signedAt: new Date(Number(timestamp) * 1000).toISOString(),
    };
  }

  parseWebhook(raw: RawWebhook): CounterpartyEvent[] {
    const payload = JSON.parse(raw.body.toString('utf8')) as {
      id?: string;
      type?: string;
      clientOrderId?: string;
      occurredAt?: string;
      data?: unknown;
    };
    return [
      {
        source: 'broker',
        kind: payload.type ?? 'unknown',
        deliveryId: payload.id ?? 'unknown',
        occurredAt: payload.occurredAt ?? raw.receivedAt,
        clientRef: payload.clientOrderId,
        data: payload.data ?? {},
      },
    ];
  }

  signWebhook(payload: unknown, timestampSeconds: number): RawWebhook {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = createHmac('sha256', this.options.webhookSecret)
      .update(`${timestampSeconds}.${body.toString('utf8')}`)
      .digest('hex');
    return {
      body,
      headers: {
        'x-broker-signature': signature,
        'x-broker-timestamp': String(timestampSeconds),
        'x-broker-delivery': `dlv_${timestampSeconds}`,
      },
      receivedAt: this.options.clock.nowIso(),
    };
  }
}
