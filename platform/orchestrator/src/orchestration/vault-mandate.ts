/**
 * The vault mandate — operator-side shadow of one on-chain pre-IPO vault.
 *
 * A vault is not per-user. Depositing is permissionless on-chain, so individual
 * subscriptions become `VAULT_SUBSCRIBE` intents that exist only to screen the
 * depositor and book the liability. The *deal* is orchestrated here: one
 * mandate per listing event, driving the thirteen-phase lifecycle in
 * `marco-vault` against a real IPO application at the broker.
 *
 * Every phase advance is an operator action backed by a real off-chain event.
 * The mandate's job is to make sure the on-chain phase never runs ahead of the
 * off-chain fact that justifies it.
 */

import { IllegalTransitionError } from '../domain/errors.js';
import type { Money, Quantity } from '../domain/money.js';
import type { VaultPhase } from '../ports/chain.js';

/**
 * Permitted phase advances, mirroring the program's state machine. The
 * orchestrator refuses to submit a transition the program would reject, so a
 * mis-sequenced operator action fails here with a readable error rather than
 * as an opaque Anchor constraint violation.
 */
const PHASE_TRANSITIONS: Record<VaultPhase, readonly VaultPhase[]> = {
  Scheduled: ['Funding', 'Cancelled'],
  Funding: ['Sealed', 'Cancelled'],
  Sealed: ['Sourcing', 'Cancelled'],
  Sourcing: ['Sourced', 'Cancelled'],
  Sourced: ['Deployed', 'Cancelled'],
  // Past deployment there is no cancellation path — capital has left.
  Deployed: ['Live'],
  Live: ['Realized'],
  Realized: ['Claimable'],
  Claimable: ['Winding', 'Concluded'],
  Winding: ['Concluded'],
  Concluded: [],
  Cancelled: ['Refunded'],
  Refunded: [],
};

export function canAdvancePhase(from: VaultPhase, to: VaultPhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function assertPhaseAdvance(from: VaultPhase, to: VaultPhase): void {
  if (!canAdvancePhase(from, to)) {
    throw new IllegalTransitionError(from, to, 'Vault');
  }
}

/** Past this point capital has left the vault and refunds are impossible. */
export function isCancellable(phase: VaultPhase): boolean {
  return PHASE_TRANSITIONS[phase].includes('Cancelled');
}

/* -------------------------------------------------------------------------- */

export type MandateState = 'ACTIVE' | 'BLOCKED' | 'NEEDS_MANUAL' | 'CLOSED';

export interface VaultMandateFacts {
  /* Sourcing — the IPO application */
  ipoSubscriptionRef?: string;
  ipoBrokerRef?: string;
  appliedAmount?: Money;
  appliedQuantity?: Quantity;
  allocatedQuantity?: Quantity;
  allocatedAmount?: Money;
  registrarRefund?: Money;

  /* Funding the application */
  conversionRef?: string;
  convertedAmount?: Money;
  fxRateDecimal?: string;
  payoutRef?: string;

  /* Listing and custody */
  listedTicker?: string;
  finalOfferPrice?: Money;
  custodyPositionRef?: string;
  custodyDocumentRef?: string;
  custodyDocumentHash?: string;

  /* Realisation */
  saleClientOrderId?: string;
  soldQuantity?: Quantity;
  saleAveragePrice?: Money;
  grossProceedsHkd?: Money;
  repatriationRef?: string;
  netProceedsUsdc?: Money;

  /* Delivery elections settled against the custodian */
  deliveredShares?: bigint;

  /* Cancellation */
  unrefundableCosts?: Money;
  cancellationReason?: string;
}

export interface VaultMandate {
  readonly id: string;
  /** On-chain vault identifier. */
  readonly vaultId: string;
  /** The broker's identifier for the listing this vault subscribes to. */
  readonly listingId: string;
  readonly companyName: string;
  readonly state: MandateState;
  /** Last phase observed on-chain. Read, never assumed. */
  readonly phase: VaultPhase;
  /** Phase the operator has authorised advancing to, if any. */
  readonly requestedPhase: VaultPhase | null;
  readonly facts: VaultMandateFacts;

  /** Seconds the delivery-election window stays open at mark_listed. */
  readonly electionPeriodSeconds: number;
  readonly brokerAccountRef: string;
  readonly custodyAccountRef: string;

  readonly attempts: Readonly<Record<string, number>>;
  readonly nextAttemptAt: string | null;
  readonly manualReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type NewVaultMandate = Pick<
  VaultMandate,
  | 'vaultId'
  | 'listingId'
  | 'companyName'
  | 'electionPeriodSeconds'
  | 'brokerAccountRef'
  | 'custodyAccountRef'
> & { readonly facts?: VaultMandateFacts };
