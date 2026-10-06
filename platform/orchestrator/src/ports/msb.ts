/**
 * Money Services Business port — the on/off ramp and the rails that move value
 * between Solana and the Hong Kong banking system.
 *
 * Deliberately narrow. Marco needs exactly four things from an MSB:
 *
 *   1. an address to receive USDC on Solana (fixed on-chain at market creation,
 *      so it must be stable for the life of the market);
 *   2. a USDC↔HKD crossing at a quoted rate;
 *   3. a payout leg into the broker's settlement account, and back out to a
 *      Solana address for redemptions;
 *   4. balances and statements good enough to reconcile against.
 *
 * Anything a specific provider offers beyond this stays inside its adapter.
 */

import type { Currency, Money } from '../domain/money.js';
import type { FxRate } from '../domain/money.js';
import type { WebhookCapable } from './webhook.js';

export type ConversionStatus =
  | 'PENDING'
  | 'EXECUTING'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED';

export type PayoutStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'SENT'
  | 'SETTLED'
  | 'RETURNED'
  | 'FAILED';

/** Why value is moving. Providers require a purpose code for AML reporting. */
export type TransferPurpose =
  | 'SECURITIES_SETTLEMENT'
  | 'IPO_SUBSCRIPTION'
  | 'CUSTOMER_REDEMPTION'
  | 'TREASURY_FUNDING'
  | 'TREASURY_REPATRIATION';

export interface ConversionQuote {
  readonly quoteId: string;
  readonly rate: FxRate;
  readonly from: Money;
  readonly to: Money;
  /** Provider fee, expressed in the source currency. */
  readonly fee: Money;
  readonly expiresAt: string;
}

export interface Conversion {
  readonly id: string;
  readonly clientRef: string;
  readonly status: ConversionStatus;
  readonly from: Money;
  /** Null until the provider fixes the rate. */
  readonly to: Money | null;
  readonly rate: FxRate | null;
  readonly fee: Money | null;
  readonly purpose: TransferPurpose;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly failureReason: string | null;
}

/** Where a payout lands. Only two rails matter for Marco. */
export type PayoutDestination =
  | {
      readonly rail: 'BANK';
      /** Opaque provider-side beneficiary id. Never raw account numbers here. */
      readonly beneficiaryId: string;
      /** Free-text reference the beneficiary sees on their statement. */
      readonly reference: string;
    }
  | {
      readonly rail: 'SOLANA';
      readonly address: string;
      readonly mint: string;
    };

export interface Payout {
  readonly id: string;
  readonly clientRef: string;
  readonly status: PayoutStatus;
  readonly amount: Money;
  readonly fee: Money | null;
  readonly destination: PayoutDestination;
  readonly purpose: TransferPurpose;
  /** Wire reference / Solana signature once the rail has one. */
  readonly railReference: string | null;
  readonly createdAt: string;
  readonly settledAt: string | null;
  readonly failureReason: string | null;
}

export interface MsbBalance {
  readonly currency: Currency;
  readonly available: Money;
  readonly pending: Money;
}

export interface MsbStatementLine {
  readonly id: string;
  readonly postedAt: string;
  readonly currency: Currency;
  /** Signed: positive is a credit to Marco's account at the MSB. */
  readonly amount: Money;
  readonly description: string;
  readonly clientRef: string | null;
  readonly relatedId: string | null;
}

export interface DepositInstructions {
  readonly currency: Currency;
  /** Solana address for stablecoin, or an opaque bank reference for fiat. */
  readonly address: string;
  readonly mint?: string;
  /** Memo the sender must include so the provider can attribute the deposit. */
  readonly memo?: string;
}

export interface CreateConversionRequest {
  /** Deterministic. The provider must treat a repeat as the same conversion. */
  readonly clientRef: string;
  readonly from: Money;
  readonly to: Currency;
  readonly purpose: TransferPurpose;
  /** Bind to a previously obtained quote. Omit to convert at the live rate. */
  readonly quoteId?: string;
  /**
   * Refuse to settle worse than this. Without it a conversion executed during a
   * dislocation can under-fund an order that was already placed.
   */
  readonly worstAcceptableRate?: FxRate;
}

export interface CreatePayoutRequest {
  readonly clientRef: string;
  readonly amount: Money;
  readonly destination: PayoutDestination;
  readonly purpose: TransferPurpose;
  /**
   * Originator and beneficiary details required by the FATF travel rule for
   * transfers above the local threshold. The adapter maps this to the
   * provider's schema; the orchestrator supplies it from the account record.
   */
  readonly travelRule?: TravelRuleData;
}

export interface TravelRuleData {
  readonly originatorName: string;
  readonly originatorAccountRef: string;
  readonly beneficiaryName: string;
  readonly beneficiaryAccountRef: string;
}

export interface MoneyServicesProvider extends WebhookCapable {
  readonly id: string;

  /** Stable address for receiving value. Fixed on-chain, so it must not rotate. */
  getDepositInstructions(currency: Currency): Promise<DepositInstructions>;

  quoteConversion(from: Money, to: Currency): Promise<ConversionQuote>;

  /** Idempotent on `clientRef`. A repeat returns the original conversion. */
  createConversion(request: CreateConversionRequest): Promise<Conversion>;

  getConversion(clientRefOrId: string): Promise<Conversion | null>;

  /** Idempotent on `clientRef`. A repeat must never send a second payment. */
  createPayout(request: CreatePayoutRequest): Promise<Payout>;

  getPayout(clientRefOrId: string): Promise<Payout | null>;

  getBalances(): Promise<MsbBalance[]>;

  listStatement(from: string, to: string): Promise<MsbStatementLine[]>;
}
