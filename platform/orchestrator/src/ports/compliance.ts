/**
 * Compliance port.
 *
 * Verification is carried by Marco on every beneficial owner beneath its
 * omnibus account and evidenced to the broker and custodian on request, so
 * screening is a hard gate in front of every intent — not a background job.
 *
 * Two distinct checks, deliberately separate:
 *   - **Verification** is durable identity state on the account.
 *   - **Screening** is a point-in-time decision on a specific action, because
 *     sanctions lists and wallet risk scores change between orders.
 */

import type { Money } from '../domain/money.js';

export type VerificationStatus =
  | 'NONE'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

/**
 * Assurance tiers. A given action demands a tier; thresholds are set with
 * Marco's broker, custodian and counsel and vary by offering and jurisdiction.
 */
export type AssuranceTier = 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';

export interface VerificationRecord {
  readonly wallet: string;
  readonly status: VerificationStatus;
  readonly tier: AssuranceTier;
  readonly subjectRef: string;
  readonly jurisdiction: string;
  /** Professional / accredited investor flag, required for some offerings. */
  readonly professionalInvestor: boolean;
  readonly verifiedAt: string | null;
  readonly expiresAt: string | null;
}

export type ScreeningDecision = 'CLEAR' | 'REVIEW' | 'BLOCK';

export interface ScreeningResult {
  readonly decision: ScreeningDecision;
  readonly screeningId: string;
  readonly screenedAt: string;
  readonly reasons: readonly string[];
  /** Provider risk score, 0–100. Higher is worse. */
  readonly riskScore: number;
}

export type ActionKind =
  | 'SPOT_BUY'
  | 'SPOT_SELL'
  | 'VAULT_SUBSCRIBE'
  | 'VAULT_REDEEM'
  | 'VAULT_DELIVERY';

export interface ScreeningRequest {
  readonly wallet: string;
  readonly action: ActionKind;
  readonly amount: Money;
  readonly ticker?: string;
  /** Counterparty address for on-chain flow-of-funds analysis. */
  readonly counterpartyAddress?: string;
}

export interface LimitAssessment {
  readonly withinLimits: boolean;
  readonly reasons: readonly string[];
  readonly remainingDaily: Money | null;
  readonly remainingMonthly: Money | null;
}

export interface ComplianceProvider {
  readonly id: string;

  getVerification(wallet: string): Promise<VerificationRecord | null>;

  upsertVerification(record: VerificationRecord): Promise<VerificationRecord>;

  /** Point-in-time screen. Called before every intent, never cached. */
  screen(request: ScreeningRequest): Promise<ScreeningResult>;

  /** Per-account velocity and notional limits. */
  assessLimits(request: ScreeningRequest): Promise<LimitAssessment>;

  /** Minimum assurance tier for an action, given size and offering. */
  requiredTier(action: ActionKind, amount: Money): Promise<AssuranceTier>;
}

const TIER_ORDER: Record<AssuranceTier, number> = {
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
};

export function tierSatisfies(held: AssuranceTier, required: AssuranceTier): boolean {
  return TIER_ORDER[held] >= TIER_ORDER[required];
}
