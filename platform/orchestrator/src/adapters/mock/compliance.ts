/**
 * Mock compliance provider.
 *
 * Screening decisions are driven by explicit rules a test can set, because
 * "what happens when a wallet is blocked *after* it has already deposited" is
 * exactly the case that must be exercised, and a random risk score cannot test
 * it.
 */

import type { Clock } from '../../domain/clock.js';
import { compare, money, type Money } from '../../domain/money.js';
import type {
  ActionKind,
  AssuranceTier,
  ComplianceProvider,
  LimitAssessment,
  ScreeningDecision,
  ScreeningRequest,
  ScreeningResult,
  VerificationRecord,
} from '../../ports/compliance.js';

export interface MockComplianceOptions {
  readonly clock: Clock;
  /** Applies when a wallet has no explicit rule. */
  readonly defaultDecision?: ScreeningDecision;
  /** Notional above which an action demands professional-investor assurance. */
  readonly professionalThresholdUsdc?: bigint;
}

export class MockCompliance implements ComplianceProvider {
  readonly id = 'mock-compliance';

  private readonly verifications = new Map<string, VerificationRecord>();
  private readonly decisions = new Map<string, { decision: ScreeningDecision; reasons: string[] }>();
  private readonly dailyLimits = new Map<string, Money>();
  private sequence = 0;

  constructor(private readonly options: MockComplianceOptions) {}

  async getVerification(wallet: string): Promise<VerificationRecord | null> {
    const record = this.verifications.get(wallet);
    if (!record) return null;
    if (record.expiresAt && record.expiresAt < this.options.clock.nowIso()) {
      return { ...record, status: 'EXPIRED' };
    }
    return record;
  }

  async upsertVerification(record: VerificationRecord): Promise<VerificationRecord> {
    this.verifications.set(record.wallet, record);
    return record;
  }

  async screen(request: ScreeningRequest): Promise<ScreeningResult> {
    this.sequence += 1;
    const rule = this.decisions.get(request.wallet);
    const decision = rule?.decision ?? this.options.defaultDecision ?? 'CLEAR';

    return {
      decision,
      screeningId: `scr_${String(this.sequence).padStart(8, '0')}`,
      screenedAt: this.options.clock.nowIso(),
      reasons: rule?.reasons ?? (decision === 'CLEAR' ? [] : ['Default rule']),
      riskScore: decision === 'BLOCK' ? 95 : decision === 'REVIEW' ? 60 : 5,
    };
  }

  async assessLimits(request: ScreeningRequest): Promise<LimitAssessment> {
    const limit = this.dailyLimits.get(request.wallet);
    if (!limit) {
      return { withinLimits: true, reasons: [], remainingDaily: null, remainingMonthly: null };
    }
    const within = compare(request.amount, limit) <= 0;
    return {
      withinLimits: within,
      reasons: within
        ? []
        : [`Order of ${request.amount.amount} exceeds the daily limit of ${limit.amount}`],
      remainingDaily: limit,
      remainingMonthly: null,
    };
  }

  /**
   * Pre-IPO offerings may be restricted to professional investors, and size
   * escalates the requirement on every product. Kept deliberately explicit —
   * the real thresholds are set with counsel, the broker and the custodian.
   */
  async requiredTier(action: ActionKind, amount: Money): Promise<AssuranceTier> {
    const threshold = this.options.professionalThresholdUsdc ?? 100_000_000_000n;

    if (action === 'VAULT_SUBSCRIBE' || action === 'VAULT_DELIVERY') {
      return amount.amount >= threshold ? 'TIER_3' : 'TIER_2';
    }
    return amount.amount >= threshold ? 'TIER_2' : 'TIER_1';
  }

  /* ---- Test hooks ------------------------------------------------------ */

  setDecision(wallet: string, decision: ScreeningDecision, reasons: string[] = []): void {
    this.decisions.set(wallet, { decision, reasons });
  }

  setDailyLimit(wallet: string, limit: Money): void {
    this.dailyLimits.set(wallet, limit);
  }

  /** Register a verified wallet at a given tier. */
  verify(
    wallet: string,
    tier: AssuranceTier = 'TIER_2',
    overrides: Partial<VerificationRecord> = {},
  ): VerificationRecord {
    const record: VerificationRecord = {
      wallet,
      status: 'VERIFIED',
      tier,
      subjectRef: `subj_${wallet.slice(0, 8)}`,
      jurisdiction: 'HK',
      professionalInvestor: tier === 'TIER_3',
      verifiedAt: this.options.clock.nowIso(),
      expiresAt: null,
      ...overrides,
    };
    this.verifications.set(wallet, record);
    return record;
  }
}

export const usdcAmount = (amount: bigint): Money => money('USDC', amount);
