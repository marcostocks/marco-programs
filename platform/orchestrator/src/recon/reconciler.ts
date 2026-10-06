/**
 * Three-way reconciliation.
 *
 * Compares what Marco believes (the ledger) against what Solana says and what
 * the counterparties say. The headline invariant is the one the product
 * documentation asserts to users:
 *
 *     shares held by the custodian  ==  position tokens outstanding on Solana
 *                                   ==  the position ledger
 *
 * A disagreement between any two of the three is a **break**. Breaks are
 * recorded and escalated; they are never auto-resolved. Silently adjusting the
 * books to match a counterparty is how a real discrepancy becomes invisible.
 *
 * Reconciliation is read-only with respect to money. It writes breaks, and
 * nothing else.
 */

import type { Clock } from '../domain/clock.js';
import { newId, type IdSource, systemIdSource } from '../domain/ids.js';
import { subtract, type Currency, type Money } from '../domain/money.js';
import { CASH_ACCOUNTS, POSITION_ACCOUNTS } from '../ledger/accounts.js';
import type { Ledger } from '../ledger/ledger.js';
import type { Services } from '../services.js';
import type { BreakKind, BreakSeverity, ReconBreak } from '../ports/store.js';

export interface ReconRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly checks: number;
  readonly breaks: readonly ReconBreak[];
  readonly clean: boolean;
}

interface Finding {
  kind: BreakKind;
  severity: BreakSeverity;
  scope: string;
  description: string;
  ledgerValue: string | null;
  chainValue: string | null;
  counterpartyValue: string | null;
  delta: string | null;
  relatedIntentIds?: string[];
}

export class Reconciler {
  private readonly clock: Clock;

  constructor(
    private readonly services: Services,
    private readonly idSource: IdSource = systemIdSource,
  ) {
    this.clock = services.clock;
  }

  /**
   * @param scope Which markets and vaults to reconcile. Both are needed because
   * the on-chain escrow figure aggregates across every market and vault, so it
   * can only be checked against a complete set.
   */
  async run(scope: { tickers: readonly string[]; vaultIds?: readonly string[] }): Promise<ReconRun> {
    const runId = newId('rec', this.idSource);
    const startedAt = this.clock.nowIso();
    const findings: Finding[] = [];
    const vaultIds = scope.vaultIds ?? [];

    // The ledger must balance against itself before it is worth comparing to
    // anything else. A failure here is a code defect, not a counterparty break.
    findings.push(...this.checkTrialBalance(this.services.ledger));

    for (const ticker of scope.tickers) {
      findings.push(...(await this.checkPositions(ticker)));
    }

    findings.push(...(await this.checkChainEscrow(scope.tickers, vaultIds)));
    findings.push(...(await this.checkBrokerCash()));
    findings.push(...(await this.checkMsbBalances()));
    findings.push(...(await this.checkStalled()));
    findings.push(...this.checkSuspense());

    const breaks = await this.record(runId, findings);

    return {
      runId,
      startedAt,
      finishedAt: this.clock.nowIso(),
      checks: 5 + scope.tickers.length,
      breaks,
      clean: breaks.length === 0,
    };
  }

  /* ---- Checks ---------------------------------------------------------- */

  private checkTrialBalance(ledger: Ledger): Finding[] {
    const trial = ledger.trialBalance();
    const findings: Finding[] = [];

    for (const [currency, total] of Object.entries(trial.cash)) {
      if (total !== '0') {
        findings.push({
          kind: 'CASH',
          severity: 'CRITICAL',
          scope: `trial-balance:${currency}`,
          description:
            `The ledger does not balance in ${currency} (net ${total}). This is a code ` +
            `defect in a posting template, not a counterparty discrepancy.`,
          ledgerValue: total,
          chainValue: null,
          counterpartyValue: null,
          delta: total,
        });
      }
    }

    for (const [ticker, total] of Object.entries(trial.positions)) {
      if (total !== '0') {
        findings.push({
          kind: 'POSITION',
          severity: 'CRITICAL',
          scope: `trial-balance:${ticker}`,
          description: `The position ledger does not balance in ${ticker} (net ${total}).`,
          ledgerValue: total,
          chainValue: null,
          counterpartyValue: null,
          delta: total,
        });
      }
    }

    return findings;
  }

  /**
   * The backing invariant. Custodian holdings, on-chain token supply and the
   * position ledger must agree exactly.
   *
   * In-flight quantities are excluded deliberately: a trade that filled today
   * and settles at T+2 is legitimately in `CUSTODY_INBOUND` and legitimately
   * absent from both custody's settled figure and token supply.
   */
  private async checkPositions(ticker: string): Promise<Finding[]> {
    const { ledger, chain, custodian, config } = this.services;
    const findings: Finding[] = [];

    const [market, custody] = await Promise.all([
      chain.getMarket(ticker),
      custodian.getPosition(config.accounts.custodyRef, ticker),
    ]);

    // Liability accounts carry credit-negative balances; magnitude is the count.
    const ledgerTokens = -ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTOMER_POSITIONS, ticker);
    const ledgerHoldings = ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTODY_HOLDINGS, ticker);
    const chainSupply = market?.positionSupply.units ?? 0n;
    const custodyHoldings = custody?.settled.units ?? 0n;

    /**
     * Shares sold and released by the custodian whose tokens have not burned
     * yet. `settle_sell` burns and pays in one instruction, and it runs *after*
     * the custodian confirms release — so there is a legitimate window where
     * custody has fallen but supply has not.
     *
     * Without this allowance every ordinary sell would raise a CRITICAL
     * shortfall and, through the mint interlock, freeze buying in the name. A
     * control that fires on normal operation is worse than no control: it
     * teaches people to ignore it.
     */
    const awaitingBurn = ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTODY_OUTBOUND, ticker);

    if (ledgerTokens !== chainSupply) {
      findings.push({
        kind: 'POSITION',
        severity: 'CRITICAL',
        scope: `positions:${ticker}:supply`,
        description:
          `Position-token supply on Solana (${chainSupply}) does not match the ledger ` +
          `obligation to holders (${ledgerTokens}) for ${ticker}.`,
        ledgerValue: ledgerTokens.toString(),
        chainValue: chainSupply.toString(),
        counterpartyValue: null,
        delta: (chainSupply - ledgerTokens).toString(),
      });
    }

    /**
     * Our record of custodied shares against theirs.
     *
     * WARN rather than CRITICAL, because this comparison is genuinely
     * timing-sensitive: our books move at the broker fill, the custodian's move
     * at settlement, and the two are legitimately apart for the whole
     * settlement window. It is a signal worth watching, not a page — the
     * backing check below is the one with teeth.
     */
    if (ledgerHoldings !== custodyHoldings) {
      findings.push({
        kind: 'POSITION',
        severity: 'WARN',
        scope: `positions:${ticker}:custody`,
        description:
          `Custodian holds ${custodyHoldings} ${ticker} but the ledger records ` +
          `${ledgerHoldings}. Expected to differ during a settlement window; ` +
          `investigate if it persists past settlement.`,
        ledgerValue: ledgerHoldings.toString(),
        chainValue: null,
        counterpartyValue: custodyHoldings.toString(),
        delta: (custodyHoldings - ledgerHoldings).toString(),
      });
    }

    // The claim made to users: every token is backed by a real custodied share,
    // or by one already sold whose burn is still in flight.
    const backing = custodyHoldings + awaitingBurn;
    if (backing < chainSupply) {
      findings.push({
        kind: 'POSITION',
        severity: 'CRITICAL',
        scope: `positions:${ticker}:backing`,
        description:
          `BACKING SHORTFALL: ${chainSupply} ${ticker} tokens are outstanding but only ` +
          `${backing} shares back them (${custodyHoldings} held at the custodian` +
          `${awaitingBurn > 0n ? ` + ${awaitingBurn} sold and awaiting burn` : ''}). ` +
          `Minting is blocked. Halt the market and investigate.`,
        ledgerValue: ledgerTokens.toString(),
        chainValue: chainSupply.toString(),
        counterpartyValue: custodyHoldings.toString(),
        delta: (backing - chainSupply).toString(),
      });
    }

    return findings;
  }

  /**
   * USDC actually locked on-chain must match what the ledger says sits there.
   *
   * `CHAIN_ESCROW` aggregates every spot market escrow and every vault balance,
   * so this compares the sum across the full scope rather than per market. An
   * incomplete scope would read as a shortfall, which is why `run` requires
   * both lists.
   */
  private async checkChainEscrow(
    tickers: readonly string[],
    vaultIds: readonly string[],
  ): Promise<Finding[]> {
    const { ledger, chain } = this.services;

    let onChain = 0n;
    for (const ticker of tickers) {
      const market = await chain.getMarket(ticker);
      onChain += market?.escrowBalance.amount ?? 0n;
    }
    for (const vaultId of vaultIds) {
      const vault = await chain.getVault(vaultId);
      onChain += vault?.usdcBalance.amount ?? 0n;
    }

    // Fees earned but not yet swept still sit in the on-chain accounts, and the
    // ledger tracks them separately from customer escrow.
    const ledgerEscrow = ledger.balance(CASH_ACCOUNTS.CHAIN_ESCROW, 'USDC');
    const ledgerFees = ledger.balance(CASH_ACCOUNTS.CHAIN_FEES_RECEIVABLE, 'USDC');
    const ledgerTotal = ledgerEscrow.amount + ledgerFees.amount;

    if (onChain === ledgerTotal) return [];

    const delta = onChain - ledgerTotal;
    return [
      {
        kind: 'CASH',
        severity: severityForCash({ currency: 'USDC', amount: delta }),
        scope: 'cash:chain_escrow:USDC',
        description:
          `Solana holds ${onChain} USDC across the reconciled markets and vaults; the ledger ` +
          `records ${ledgerTotal} (escrow ${ledgerEscrow.amount} + unswept fees ${ledgerFees.amount}).`,
        ledgerValue: ledgerTotal.toString(),
        chainValue: onChain.toString(),
        counterpartyValue: null,
        delta: delta.toString(),
      },
    ];
  }

  private async checkBrokerCash(): Promise<Finding[]> {
    const { ledger, broker, config } = this.services;
    const findings: Finding[] = [];

    const buyingPower = await broker.getBuyingPower(config.accounts.brokerRef);
    const ledgerBuffer = ledger.balance(CASH_ACCOUNTS.BROKER_BUFFER, 'HKD');

    const delta = subtract(buyingPower.available, ledgerBuffer);
    if (delta.amount !== 0n) {
      findings.push({
        kind: 'CASH',
        severity: severityForCash(delta),
        scope: 'cash:broker:HKD',
        description:
          `Broker reports ${buyingPower.available.amount} HKD available; the ledger says ` +
          `${ledgerBuffer.amount}.`,
        ledgerValue: ledgerBuffer.amount.toString(),
        chainValue: null,
        counterpartyValue: buyingPower.available.amount.toString(),
        delta: delta.amount.toString(),
      });
    }

    return findings;
  }

  private async checkMsbBalances(): Promise<Finding[]> {
    const { ledger, msb } = this.services;
    const findings: Finding[] = [];

    const balances = await msb.getBalances();
    for (const balance of balances) {
      // The provider holds one balance per currency; we split it across two
      // accounts by stage — handed over but not yet crossed (`transit`), and
      // crossed but not yet paid out (`settled`). Compare against the sum.
      const transit = ledger.balance(CASH_ACCOUNTS.MSB_TRANSIT, balance.currency);
      const settled = ledger.balance(CASH_ACCOUNTS.MSB_SETTLED, balance.currency);
      const ledgerValue = { currency: balance.currency, amount: transit.amount + settled.amount };

      const delta = subtract(balance.available, ledgerValue);
      if (delta.amount !== 0n) {
        findings.push({
          kind: 'CASH',
          severity: severityForCash(delta),
          scope: `cash:msb:${balance.currency}`,
          description:
            `MSB reports ${balance.available.amount} ${balance.currency}; the ledger says ` +
            `${ledgerValue.amount} (transit ${transit.amount} + settled ${settled.amount}).`,
          ledgerValue: ledgerValue.amount.toString(),
          chainValue: null,
          counterpartyValue: balance.available.amount.toString(),
          delta: delta.amount.toString(),
        });
      }
    }

    return findings;
  }

  /**
   * Intents parked for a human, and anything that has been waiting far longer
   * than its counterparty's own SLA. A stalled intent is usually the first
   * visible symptom of a counterparty problem.
   */
  private async checkStalled(): Promise<Finding[]> {
    const { store } = this.services;
    const findings: Finding[] = [];

    const parked = await store.intents.list({ state: 'NEEDS_MANUAL' });
    if (parked.length > 0) {
      findings.push({
        kind: 'STALE',
        severity: 'WARN',
        scope: 'intents:needs_manual',
        description: `${parked.length} intent(s) are parked for manual review.`,
        ledgerValue: String(parked.length),
        chainValue: null,
        counterpartyValue: null,
        delta: null,
        relatedIntentIds: parked.map((intent) => intent.id),
      });
    }

    // HKEX settles T+2; anything still waiting after five days is stuck, not slow.
    const cutoff = new Date(this.clock.nowMillis() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const waiting = await store.intents.list({ state: 'WAITING' });
    const stale = waiting.filter((intent) => intent.updatedAt < cutoff);
    if (stale.length > 0) {
      findings.push({
        kind: 'STALE',
        severity: 'WARN',
        scope: 'intents:stale_waiting',
        description:
          `${stale.length} intent(s) have been waiting on an external event for more than ` +
          `five days.`,
        ledgerValue: String(stale.length),
        chainValue: null,
        counterpartyValue: null,
        delta: null,
        relatedIntentIds: stale.map((intent) => intent.id),
      });
    }

    return findings;
  }

  /** A non-zero suspense balance is an alarm, never a resting state. */
  private checkSuspense(): Finding[] {
    const { ledger } = this.services;
    const findings: Finding[] = [];

    const currencies: Currency[] = ['USDC', 'HKD', 'USDT', 'USD', 'CNH'];
    for (const currency of currencies) {
      const balance = ledger.balance(CASH_ACCOUNTS.SUSPENSE, currency);
      if (balance.amount !== 0n) {
        findings.push({
          kind: 'CASH',
          severity: 'CRITICAL',
          scope: `suspense:${currency}`,
          description: `Suspense holds ${balance.amount} ${currency} awaiting explanation.`,
          ledgerValue: balance.amount.toString(),
          chainValue: null,
          counterpartyValue: null,
          delta: balance.amount.toString(),
        });
      }
    }

    return findings;
  }

  /* ---- Recording ------------------------------------------------------- */

  /**
   * Persist findings, reusing an existing open break for the same scope so a
   * recurring discrepancy produces one item that stays open rather than a new
   * alert every run.
   */
  private async record(runId: string, findings: readonly Finding[]): Promise<ReconBreak[]> {
    const { store, logger } = this.services;
    const recorded: ReconBreak[] = [];

    for (const finding of findings) {
      const existing = await store.breaks.findOpenByScope(finding.kind, finding.scope);
      if (existing) {
        recorded.push(
          await store.breaks.save(
            {
              ...existing,
              runId,
              severity: finding.severity,
              description: finding.description,
              ledgerValue: finding.ledgerValue,
              chainValue: finding.chainValue,
              counterpartyValue: finding.counterpartyValue,
              delta: finding.delta,
              relatedIntentIds: finding.relatedIntentIds ?? existing.relatedIntentIds,
            },
            existing.version,
          ),
        );
        continue;
      }

      const created = await store.breaks.create({
        id: newId('brk_item', this.idSource),
        runId,
        kind: finding.kind,
        severity: finding.severity,
        scope: finding.scope,
        description: finding.description,
        ledgerValue: finding.ledgerValue,
        chainValue: finding.chainValue,
        counterpartyValue: finding.counterpartyValue,
        delta: finding.delta,
        relatedIntentIds: finding.relatedIntentIds ?? [],
        status: 'OPEN',
        detectedAt: this.clock.nowIso(),
        resolvedAt: null,
        resolution: null,
        version: 1,
      });
      recorded.push(created);

      logger.error(
        { breakId: created.id, scope: created.scope, severity: created.severity },
        'Reconciliation break detected',
      );
    }

    return recorded;
  }

  /**
   * Close a break. Requires a written resolution — a break that vanishes
   * without an explanation is worse than one that stays open.
   */
  async resolveBreak(breakId: string, resolution: string): Promise<ReconBreak> {
    const { store } = this.services;
    const item = await store.breaks.get(breakId);
    if (!item) throw new Error(`Break ${breakId} not found`);
    if (!resolution.trim()) throw new Error('A resolution note is required to close a break');

    return store.breaks.save(
      { ...item, status: 'RESOLVED', resolvedAt: this.clock.nowIso(), resolution },
      item.version,
    );
  }
}

/**
 * Cash breaks scale with size. A rounding-level difference is worth recording
 * but should not page anyone at 3am; a large one should.
 */
function severityForCash(delta: Money): BreakSeverity {
  const magnitude = delta.amount < 0n ? -delta.amount : delta.amount;
  // Thresholds in minor units: HKD/USD at 2dp, USDC at 6dp.
  const warnAt = delta.currency === 'USDC' || delta.currency === 'USDT' ? 1_000_000n : 100_00n;
  const criticalAt = warnAt * 1000n;

  if (magnitude >= criticalAt) return 'CRITICAL';
  if (magnitude >= warnAt) return 'WARN';
  return 'INFO';
}
