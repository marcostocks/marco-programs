/**
 * Wire serialisation.
 *
 * `bigint` does not survive `JSON.stringify`, and silently coercing it to a
 * `number` would corrupt any amount above 2^53. Every response goes through
 * these helpers, which emit both exact minor units as a string and a
 * human-readable decimal.
 */

import { formatMoney, toWire, type Money, type Quantity } from '../domain/money.js';
import type { Intent } from '../orchestration/intent.js';
import type { VaultMandate } from '../orchestration/vault-mandate.js';
import type { BufferSnapshot } from '../treasury/treasury.js';
import type { Account, ReconBreak, Reservation } from '../ports/store.js';
import type { SpotHolding, SpotMarket, VaultPosition, VaultState } from '../ports/chain.js';

export function moneyOut(value: Money | null | undefined): unknown {
  if (!value) return null;
  const wire = toWire(value);
  return { currency: wire.currency, minorUnits: wire.amount, decimal: wire.decimal, display: formatMoney(value) };
}

export function quantityOut(value: Quantity | null | undefined): unknown {
  if (!value) return null;
  return { ticker: value.ticker, units: value.units.toString() };
}

/**
 * A market or a vault as one entry in a single list.
 *
 * A distributor asks "what can my users buy?" once and should not have to know
 * that the answer comes from two programs with different shapes. `kind` says
 * which, and `tradeable` answers the only question that matters before showing
 * it in a list — a paused market and a sealed vault are both still real assets
 * with holders, they just cannot be entered right now.
 */
export function assetOut(asset: SpotMarket | VaultState): unknown {
  if ('ticker' in asset) {
    return {
      kind: 'SPOT',
      id: asset.ticker,
      name: asset.ticker,
      status: asset.status,
      tradeable: asset.status === 'ACTIVE',
      feeBps: asset.feeBps,
      address: asset.marketAddress,
      positionMint: asset.positionMint,
      positionSupply: quantityOut(asset.positionSupply),
    };
  }
  return {
    kind: 'VAULT',
    id: asset.vaultId,
    name: asset.vaultId,
    status: asset.phase,
    // Funding is the only phase that accepts new money.
    tradeable: asset.phase === 'Funding',
    feeBps: asset.feeBps,
    feeAtExit: asset.feeAtExit,
    address: asset.vaultAddress,
    claimMint: asset.claimMint,
    cap: moneyOut(asset.cap),
    totalDeposits: moneyOut(asset.totalDeposits),
    totalShares: asset.totalShares.toString(),
    redeemable: asset.phase === 'Claimable',
    redeemableAmount: moneyOut(asset.redeemableAmount),
  };
}

export function holdingOut(holding: SpotHolding): unknown {
  return {
    kind: 'SPOT',
    assetId: holding.ticker,
    quantity: quantityOut(holding.openQuantity),
    averageCost: moneyOut(holding.averageCost),
    usdcSpent: moneyOut(holding.usdcSpent),
    usdcReceived: moneyOut(holding.usdcReceived),
    feesPaid: moneyOut(holding.feesPaid),
    realisedPnl: moneyOut(holding.realisedPnl),
  };
}

export function vaultPositionOut(position: VaultPosition): unknown {
  return {
    kind: 'VAULT',
    assetId: position.vaultId,
    claimTokens: position.openShares.toString(),
    subscribed: moneyOut(position.depositAmount),
    redeemed: moneyOut(position.usdcRedeemed),
    refunded: moneyOut(position.usdcRefunded),
    entryFeePaid: moneyOut(position.entryFeePaid),
    sharesDelivered: position.sharesDelivered.toString(),
  };
}

/** Recursively convert the loosely-typed facts bag for the wire. */
function factsOut(facts: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === undefined) continue;
    if (typeof value === 'bigint') output[key] = value.toString();
    else if (isMoney(value)) output[key] = moneyOut(value);
    else if (isQuantity(value)) output[key] = quantityOut(value);
    else output[key] = value;
  }
  return output;
}

function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    'currency' in value &&
    'amount' in value &&
    typeof (value as Money).amount === 'bigint'
  );
}

function isQuantity(value: unknown): value is Quantity {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ticker' in value &&
    'units' in value &&
    typeof (value as Quantity).units === 'bigint'
  );
}

export function intentOut(intent: Intent): unknown {
  return {
    id: intent.id,
    kind: intent.kind,
    state: intent.state,
    stage: intent.stage || null,
    wallet: intent.wallet,
    source: intent.source,
    request: {
      ticker: intent.request.ticker ?? null,
      vaultId: intent.request.vaultId ?? null,
      orderId: intent.request.orderId ?? null,
      amount: moneyOut(intent.request.amount),
      quantity: quantityOut(intent.request.quantity),
      limitPrice: moneyOut(intent.request.limitPrice),
    },
    facts: factsOut(intent.facts as Record<string, unknown>),
    attempts: intent.attempts,
    lastError: intent.lastError,
    manualReason: intent.manualReason,
    nextAttemptAt: intent.nextAttemptAt,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    version: intent.version,
  };
}

export function mandateOut(mandate: VaultMandate): unknown {
  return {
    id: mandate.id,
    vaultId: mandate.vaultId,
    listingId: mandate.listingId,
    companyName: mandate.companyName,
    state: mandate.state,
    phase: mandate.phase,
    requestedPhase: mandate.requestedPhase,
    facts: factsOut(mandate.facts as Record<string, unknown>),
    electionPeriodSeconds: mandate.electionPeriodSeconds,
    manualReason: mandate.manualReason,
    nextAttemptAt: mandate.nextAttemptAt,
    createdAt: mandate.createdAt,
    updatedAt: mandate.updatedAt,
    version: mandate.version,
  };
}

export function accountOut(account: Account): unknown {
  return {
    wallet: account.wallet,
    status: account.status,
    verification: account.verification
      ? {
          status: account.verification.status,
          tier: account.verification.tier,
          jurisdiction: account.verification.jurisdiction,
          professionalInvestor: account.verification.professionalInvestor,
          verifiedAt: account.verification.verifiedAt,
          expiresAt: account.verification.expiresAt,
        }
      : null,
    // Beneficiary references are opaque handles, safe to echo; the underlying
    // account details never live in this service.
    beneficiaryRefs: account.beneficiaryRefs,
    suspendedReason: account.suspendedReason,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    version: account.version,
  };
}

export function bufferOut(snapshot: BufferSnapshot): unknown {
  return {
    currency: snapshot.currency,
    balance: moneyOut(snapshot.balance),
    held: moneyOut(snapshot.held),
    available: moneyOut(snapshot.available),
    target: moneyOut(snapshot.target),
    minimum: moneyOut(snapshot.minimum),
    healthy: snapshot.healthy,
  };
}

export function reservationOut(reservation: Reservation): unknown {
  return {
    id: reservation.id,
    intentId: reservation.intentId,
    amount: moneyOut(reservation.amount),
    state: reservation.state,
    createdAt: reservation.createdAt,
    resolvedAt: reservation.resolvedAt,
    expiresAt: reservation.expiresAt,
  };
}

export function breakOut(item: ReconBreak): unknown {
  return {
    id: item.id,
    runId: item.runId,
    kind: item.kind,
    severity: item.severity,
    scope: item.scope,
    description: item.description,
    ledgerValue: item.ledgerValue,
    chainValue: item.chainValue,
    counterpartyValue: item.counterpartyValue,
    delta: item.delta,
    relatedIntentIds: item.relatedIntentIds,
    status: item.status,
    detectedAt: item.detectedAt,
    resolvedAt: item.resolvedAt,
    resolution: item.resolution,
  };
}
