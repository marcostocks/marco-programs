/**
 * Executing broker port — an SFC-licensed HK broker acting as principal on
 * HKEX, plus the IPO subscription desk the pre-IPO vaults depend on.
 *
 * Shaped around what an institutional HK broker actually exposes: a FIX 4.4
 * session or a REST order API for equities, a separate (usually manual or
 * file-based) channel for IPO applications, an intraday buying-power figure,
 * and end-of-day execution and cash statements. Adapters normalise all of it
 * to this.
 */

import type { Money, Quantity } from '../domain/money.js';
import type { WebhookCapable } from './webhook.js';

export type OrderSide = 'BUY' | 'SELL';

export type OrderStatus =
  | 'PENDING_NEW'
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export type TimeInForce = 'DAY' | 'IOC' | 'FOK';

/** HKEX halts and suspends individual names; a halted name rejects new orders. */
export type TradingStatus = 'TRADING' | 'HALTED' | 'SUSPENDED' | 'CLOSED' | 'DELISTED';

export interface Instrument {
  readonly ticker: string;
  readonly name: string;
  readonly exchange: 'HKEX';
  readonly currency: 'HKD';
  /**
   * Board lot. HKEX orders must be a whole multiple of this — 100 for most
   * names, 500 for Tencent, 1000 for others. An order that is not a whole
   * number of lots is rejected, so this is validated before placement.
   */
  readonly lotSize: bigint;
  readonly tickSize: Money;
  readonly status: TradingStatus;
}

export interface Execution {
  readonly executionId: string;
  readonly executedAt: string;
  readonly quantity: Quantity;
  readonly price: Money;
  /** Broker commission on this fill, plus HK stamp duty and levies. */
  readonly commission: Money;
  readonly levies: Money;
}

export interface BrokerOrder {
  readonly clientOrderId: string;
  readonly brokerOrderId: string | null;
  readonly status: OrderStatus;
  readonly ticker: string;
  readonly side: OrderSide;
  readonly requestedQuantity: Quantity;
  readonly filledQuantity: Quantity;
  readonly limitPrice: Money;
  /** Weighted average across all fills. Null before the first fill. */
  readonly averagePrice: Money | null;
  /** Gross consideration: average price × filled quantity. */
  readonly grossConsideration: Money | null;
  readonly totalCommission: Money;
  readonly totalLevies: Money;
  readonly executions: readonly Execution[];
  readonly placedAt: string;
  readonly completedAt: string | null;
  readonly rejectReason: string | null;
  /** Broker's own trade reference, carried through to the custodian for matching. */
  readonly tradeReference: string | null;
}

export interface PlaceOrderRequest {
  /**
   * Deterministic. Doubles as the FIX ClOrdID, so it is length-bounded before
   * it reaches the wire — see `boundedRef`.
   */
  readonly clientOrderId: string;
  readonly ticker: string;
  readonly side: OrderSide;
  readonly quantity: Quantity;
  /**
   * Hard limit. The on-chain program refuses to attest a fill worse than the
   * price the trader agreed to, so a market order can strand a position that
   * can never be minted. Limit orders only.
   */
  readonly limitPrice: Money;
  readonly timeInForce: TimeInForce;
  /** Marco's omnibus account at the broker. */
  readonly accountRef: string;
}

/* -------------------------------------------------------------------------- */
/* IPO subscription — the pre-IPO vault path                                   */
/* -------------------------------------------------------------------------- */

export type IpoSubscriptionStatus =
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'ALLOCATED'
  | 'UNSUCCESSFUL'
  | 'WITHDRAWN'
  | 'REJECTED';

export interface IpoSubscription {
  readonly clientRef: string;
  readonly brokerRef: string | null;
  readonly status: IpoSubscriptionStatus;
  readonly listingId: string;
  /** Cash applied for. HKEX IPO applications are funded up front. */
  readonly appliedAmount: Money;
  readonly appliedQuantity: Quantity;
  /** Shares actually allocated. Null until the ballot result. */
  readonly allocatedQuantity: Quantity | null;
  /** Cash consumed by the allocation; the balance is refunded by the registrar. */
  readonly allocatedAmount: Money | null;
  readonly refundAmount: Money | null;
  readonly submittedAt: string;
  readonly resolvedAt: string | null;
  readonly rejectReason: string | null;
}

export interface IpoListing {
  readonly listingId: string;
  readonly name: string;
  readonly ticker: string | null;
  readonly offerPriceRange: { readonly low: Money; readonly high: Money };
  readonly finalOfferPrice: Money | null;
  readonly lotSize: bigint;
  readonly applicationOpensAt: string;
  readonly applicationClosesAt: string;
  readonly expectedListingAt: string;
}

export interface PlaceIpoSubscriptionRequest {
  readonly clientRef: string;
  readonly listingId: string;
  readonly appliedAmount: Money;
  readonly appliedQuantity: Quantity;
  readonly accountRef: string;
}

/* -------------------------------------------------------------------------- */

export interface BuyingPower {
  readonly accountRef: string;
  /** Settled cash available to trade against right now. */
  readonly available: Money;
  /** Cash committed to unsettled purchases. */
  readonly committed: Money;
}

export interface CashStatementLine {
  readonly id: string;
  readonly postedAt: string;
  readonly amount: Money;
  readonly description: string;
  readonly relatedReference: string | null;
}

export interface ExecutingBroker extends WebhookCapable {
  readonly id: string;

  getInstrument(ticker: string): Promise<Instrument | null>;

  /** Idempotent on `clientOrderId`. A repeat returns the existing order. */
  placeOrder(request: PlaceOrderRequest): Promise<BrokerOrder>;

  getOrder(clientOrderId: string): Promise<BrokerOrder | null>;

  cancelOrder(clientOrderId: string): Promise<BrokerOrder>;

  /** Intraday buying power — the reading the treasury buffer is measured against. */
  getBuyingPower(accountRef: string): Promise<BuyingPower>;

  listExecutions(from: string, to: string): Promise<BrokerOrder[]>;

  listCashStatement(from: string, to: string): Promise<CashStatementLine[]>;

  /* ---- IPO ------------------------------------------------------------- */

  getIpoListing(listingId: string): Promise<IpoListing | null>;

  placeIpoSubscription(request: PlaceIpoSubscriptionRequest): Promise<IpoSubscription>;

  getIpoSubscription(clientRef: string): Promise<IpoSubscription | null>;
}
