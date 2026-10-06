/**
 * Custodian port — the regulated custodian holding the real shares 1:1 in
 * segregated accounts.
 *
 * This is the port that makes the backing claim verifiable rather than
 * asserted. `confirm_buy` on-chain will not mint without a custody reference
 * and a document fingerprint, and both come from here.
 *
 * The custodian is also the only source that can settle the position-ledger
 * invariant: shares held here must equal position tokens outstanding.
 */

import type { Money, Quantity } from '../domain/money.js';
import type { WebhookCapable } from './webhook.js';

export interface CustodyPosition {
  readonly ticker: string;
  /** Shares settled and held. */
  readonly settled: Quantity;
  /** Bought and awaiting settlement — HKEX equities settle T+2. */
  readonly pendingIn: Quantity;
  /** Sold and awaiting release. */
  readonly pendingOut: Quantity;
  readonly accountRef: string;
  readonly asOf: string;
}

export type SettlementStatus = 'PENDING' | 'SETTLED' | 'FAILED' | 'PARTIAL';

export interface SettlementRecord {
  readonly settlementId: string;
  /** The broker's trade reference. This is how a fill matches to a settlement. */
  readonly tradeReference: string;
  readonly ticker: string;
  readonly status: SettlementStatus;
  readonly quantity: Quantity;
  readonly consideration: Money;
  readonly settledAt: string | null;
  readonly expectedSettlementDate: string;
  /**
   * The custodian's own position reference for the settled holding. This is
   * what gets attested on-chain — a zeroed value is rejected by the program.
   */
  readonly positionReference: string | null;
  /** Contract note / settlement confirmation, fetched and hashed for attestation. */
  readonly documentRef: string | null;
  readonly failureReason: string | null;
}

export type DeliveryStatus = 'REQUESTED' | 'IN_PROGRESS' | 'DELIVERED' | 'REJECTED';

/**
 * A vault holder's share-delivery election. `elect_delivery` burns the claim
 * token on-chain; this moves the real shares out to the holder's own broker.
 */
export interface DeliveryInstruction {
  readonly clientRef: string;
  readonly custodianRef: string | null;
  readonly status: DeliveryStatus;
  readonly ticker: string;
  readonly quantity: Quantity;
  readonly beneficiaryRef: string;
  readonly requestedAt: string;
  readonly deliveredAt: string | null;
  readonly rejectReason: string | null;
}

export interface RequestDeliveryRequest {
  readonly clientRef: string;
  readonly ticker: string;
  readonly quantity: Quantity;
  /**
   * Opaque reference to the holder's receiving account, registered out of band.
   * Raw account details never transit the orchestrator.
   */
  readonly beneficiaryRef: string;
}

export interface CustodyStatementLine {
  readonly id: string;
  readonly postedAt: string;
  readonly ticker: string;
  /** Signed: positive is shares in. */
  readonly units: bigint;
  readonly description: string;
  readonly relatedReference: string | null;
}

export interface CustodyDocument {
  readonly documentRef: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly issuedAt: string;
}

export type CorporateActionKind =
  | 'CASH_DIVIDEND'
  | 'SCRIP_DIVIDEND'
  | 'SPLIT'
  | 'RIGHTS_ISSUE'
  | 'DELISTING';

/**
 * Corporate actions are deliberately out of scope for the first on-chain cut,
 * but the orchestrator still has to *see* them: a split that is not reflected
 * on-chain silently breaks the 1:1 invariant, so recon must be able to explain
 * the discrepancy rather than just alarm on it.
 */
export interface CorporateAction {
  readonly id: string;
  readonly kind: CorporateActionKind;
  readonly ticker: string;
  readonly exDate: string;
  readonly payDate: string | null;
  readonly recordDate: string;
  readonly cashPerShare: Money | null;
  readonly ratioNumerator: bigint | null;
  readonly ratioDenominator: bigint | null;
  readonly description: string;
}

export interface Custodian extends WebhookCapable {
  readonly id: string;

  listPositions(accountRef: string): Promise<CustodyPosition[]>;

  getPosition(accountRef: string, ticker: string): Promise<CustodyPosition | null>;

  /** Look a settlement up by the broker's trade reference. */
  getSettlementByTrade(tradeReference: string): Promise<SettlementRecord | null>;

  listSettlements(from: string, to: string): Promise<SettlementRecord[]>;

  /** Fetch the document behind a settlement so it can be hashed for attestation. */
  getDocument(documentRef: string): Promise<CustodyDocument | null>;

  /** Idempotent on `clientRef`. */
  requestDelivery(request: RequestDeliveryRequest): Promise<DeliveryInstruction>;

  getDelivery(clientRef: string): Promise<DeliveryInstruction | null>;

  listStatement(accountRef: string, from: string, to: string): Promise<CustodyStatementLine[]>;

  listCorporateActions(from: string, to: string): Promise<CorporateAction[]>;
}
