/**
 * Posting templates.
 *
 * One function per economic event. Sagas call these rather than assembling
 * postings inline, so the accounting for a given event lives in exactly one
 * place and can be reviewed as accounting rather than as control flow.
 *
 * Every template below is balanced per currency and per ticker; the ledger
 * rejects it otherwise, and the test suite asserts each one independently.
 *
 * ## How the cross-currency legs work
 *
 * `FX_CLEARING` is a **position** account, not a suspense account. A USDC→HKD
 * conversion debits it in USDC and credits it in HKD; each currency balances on
 * its own, and the account is left carrying a long-USDC / short-HKD position
 * that unwinds as the cycle completes. Its net value at current rates is the
 * open FX exposure — a number the treasury desk wants anyway, so surfacing it
 * here is a feature rather than an artefact. `recogniseFxResult` moves a
 * realised residual to income.
 *
 * ## Who bears broker costs
 *
 * Commission and exchange levies are expensed to Marco, not deducted from the
 * trader's proceeds. Marco's revenue is the spread, and the spread is what
 * those costs come out of. Changing that decision means changing `sellFilled`
 * and `buyFilled` — nowhere else.
 */

import { subtract, type Money, type Quantity } from '../domain/money.js';
import { CASH_ACCOUNTS, POSITION_ACCOUNTS } from './accounts.js';
import {
  credit,
  creditShares,
  debit,
  debitShares,
  transfer,
  transferShares,
  type JournalEntryInput,
} from './ledger.js';

/* -------------------------------------------------------------------------- */
/* Spot buy                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A trader's `place_buy` landed: USDC is locked in the market escrow and we owe
 * them either shares or their money back.
 */
export function buyEscrowed(intentId: string, escrowed: Money): JournalEntryInput {
  return {
    intentId,
    reference: 'spot.buy_escrowed',
    memo: 'Trader escrowed USDC against a buy order',
    cash: [
      debit(CASH_ACCOUNTS.CHAIN_ESCROW, escrowed),
      credit(CASH_ACCOUNTS.CUSTOMER_ESCROW, escrowed),
    ],
  };
}

/**
 * `deploy_buy` confirmed: the escrow released USDC to the conversion partner
 * and the program moved the spread into `fees_collected`.
 *
 * The spread is recognised as income here — the moment the program earns it —
 * not when it is later swept to the treasury. The trader paid it, so our
 * obligation to them falls by the same amount.
 */
export function buyDeployed(intentId: string, escrowed: Money, spread: Money): JournalEntryInput {
  const net = subtract(escrowed, spread);
  return {
    intentId,
    reference: 'spot.buy_deployed',
    memo: 'Escrow released to the conversion partner; spread earned on-chain',
    cash: [
      credit(CASH_ACCOUNTS.CHAIN_ESCROW, escrowed),
      debit(CASH_ACCOUNTS.MSB_TRANSIT, net),
      debit(CASH_ACCOUNTS.CHAIN_FEES_RECEIVABLE, spread),
      debit(CASH_ACCOUNTS.CUSTOMER_ESCROW, spread),
      credit(CASH_ACCOUNTS.INCOME_SPREAD, spread),
    ],
  };
}

/**
 * The broker filled a buy against the working buffer.
 *
 * Positions: the shares exist but no token does yet, so the obligation parks in
 * `PENDING_ISSUANCE` — keeping `CUSTOMER_POSITIONS` an exact mirror of on-chain
 * token supply, which is the invariant reconciliation checks.
 */
export function buyFilled(
  intentId: string,
  consideration: Money,
  commission: Money,
  levies: Money,
  filled: Quantity,
): JournalEntryInput {
  return {
    intentId,
    reference: 'broker.buy_filled',
    memo: `Bought ${filled.units} ${filled.ticker}`,
    cash: [
      ...transfer(CASH_ACCOUNTS.BROKER_BUFFER, CASH_ACCOUNTS.BROKER_SETTLEMENT, consideration),
      credit(CASH_ACCOUNTS.BROKER_BUFFER, commission),
      debit(CASH_ACCOUNTS.EXPENSE_BROKER_COMMISSION, commission),
      credit(CASH_ACCOUNTS.BROKER_BUFFER, levies),
      debit(CASH_ACCOUNTS.EXPENSE_EXCHANGE_LEVIES, levies),
    ],
    positions: [
      debitShares(POSITION_ACCOUNTS.CUSTODY_INBOUND, filled),
      creditShares(POSITION_ACCOUNTS.PENDING_ISSUANCE, filled),
    ],
  };
}

/** The custodian confirmed settlement: shares held 1:1 in segregated accounts. */
export function custodySettled(intentId: string, settled: Quantity): JournalEntryInput {
  return {
    intentId,
    reference: 'custody.settled',
    memo: `Custodian settled ${settled.units} ${settled.ticker}`,
    positions: transferShares(
      POSITION_ACCOUNTS.CUSTODY_INBOUND,
      POSITION_ACCOUNTS.CUSTODY_HOLDINGS,
      settled,
    ),
  };
}

/**
 * `confirm_buy` minted the position token.
 *
 * The trader's remaining USDC obligation is discharged against the HKD actually
 * spent, with the currency difference landing in FX_CLEARING.
 */
export function buyMinted(
  intentId: string,
  dischargedUsdc: Money,
  considerationHkd: Money,
  minted: Quantity,
): JournalEntryInput {
  return {
    intentId,
    reference: 'chain.buy_minted',
    memo: `Minted ${minted.units} ${minted.ticker} position tokens`,
    cash: [
      credit(CASH_ACCOUNTS.BROKER_SETTLEMENT, considerationHkd),
      debit(CASH_ACCOUNTS.FX_CLEARING, considerationHkd),
      credit(CASH_ACCOUNTS.FX_CLEARING, dischargedUsdc),
      debit(CASH_ACCOUNTS.CUSTOMER_ESCROW, dischargedUsdc),
    ],
    positions: [
      debitShares(POSITION_ACCOUNTS.PENDING_ISSUANCE, minted),
      creditShares(POSITION_ACCOUNTS.CUSTOMER_POSITIONS, minted),
    ],
  };
}

/** `cancel_buy` pre-deployment: the escrow refunded the trader in full. */
export function buyCancelled(intentId: string, refunded: Money): JournalEntryInput {
  return {
    intentId,
    reference: 'chain.buy_cancelled',
    memo: 'Buy cancelled; escrow refunded to the trader',
    cash: [
      credit(CASH_ACCOUNTS.CHAIN_ESCROW, refunded),
      debit(CASH_ACCOUNTS.CUSTOMER_ESCROW, refunded),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Spot sell                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The broker filled a sell.
 *
 * `CUSTOMER_PROCEEDS` is credited with the gross **less the spread** — that is
 * what the trader is actually owed, and recognising the spread here rather than
 * at payout keeps income in the period the trade happened.
 *
 * There is deliberately no posting at `place_sell`: tokens are escrowed, not
 * burned, so supply is unchanged and `CUSTOMER_POSITIONS` must not move.
 */
export function sellFilled(
  intentId: string,
  grossProceeds: Money,
  commission: Money,
  levies: Money,
  spread: Money,
  sold: Quantity,
): JournalEntryInput {
  const netCash = subtract(subtract(grossProceeds, commission), levies);
  const owedToTrader = subtract(grossProceeds, spread);
  return {
    intentId,
    reference: 'broker.sell_filled',
    memo: `Sold ${sold.units} ${sold.ticker}`,
    cash: [
      debit(CASH_ACCOUNTS.BROKER_PROCEEDS, netCash),
      debit(CASH_ACCOUNTS.EXPENSE_BROKER_COMMISSION, commission),
      debit(CASH_ACCOUNTS.EXPENSE_EXCHANGE_LEVIES, levies),
      credit(CASH_ACCOUNTS.CUSTOMER_PROCEEDS, owedToTrader),
      credit(CASH_ACCOUNTS.INCOME_SPREAD, spread),
    ],
    positions: transferShares(
      POSITION_ACCOUNTS.CUSTODY_HOLDINGS,
      POSITION_ACCOUNTS.CUSTODY_OUTBOUND,
      sold,
    ),
  };
}

/**
 * `settle_sell` paid the trader from the USDC float.
 *
 * The USDC leaves the treasury now and the HKD repatriation replenishes it
 * separately. That decoupling is what lets a seller be paid immediately rather
 * than waiting on a cross-border wire.
 *
 * Tokens burn in the same instruction, discharging the position obligation.
 */
export function sellSettled(
  intentId: string,
  netToTraderUsdc: Money,
  owedHkd: Money,
  burned: Quantity,
): JournalEntryInput {
  return {
    intentId,
    reference: 'chain.sell_settled',
    memo: `Paid sale proceeds and burned ${burned.units} ${burned.ticker}`,
    cash: [
      credit(CASH_ACCOUNTS.TREASURY_USDC, netToTraderUsdc),
      debit(CASH_ACCOUNTS.FX_CLEARING, netToTraderUsdc),
      credit(CASH_ACCOUNTS.FX_CLEARING, owedHkd),
      debit(CASH_ACCOUNTS.CUSTOMER_PROCEEDS, owedHkd),
    ],
    positions: [
      debitShares(POSITION_ACCOUNTS.CUSTOMER_POSITIONS, burned),
      creditShares(POSITION_ACCOUNTS.CUSTODY_OUTBOUND, burned),
    ],
  };
}

/** `cancel_sell`: escrowed tokens returned to the holder and re-locked. */
export function sellCancelled(intentId: string, returned: Quantity): JournalEntryInput {
  return {
    intentId,
    reference: 'chain.sell_cancelled',
    memo: `Sell cancelled; ${returned.units} ${returned.ticker} returned to the holder`,
    positions: transferShares(
      POSITION_ACCOUNTS.CUSTODY_OUTBOUND,
      POSITION_ACCOUNTS.CUSTODY_HOLDINGS,
      returned,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Money movement                                                              */
/* -------------------------------------------------------------------------- */

/** The MSB settled a crossing. Both legs post through FX_CLEARING. */
export function conversionSettled(
  intentId: string | undefined,
  from: Money,
  to: Money,
  fee: Money,
  destination: 'BROKER_BUFFER' | 'TREASURY_USDC' | 'MSB_SETTLED',
): JournalEntryInput {
  const target =
    destination === 'BROKER_BUFFER'
      ? CASH_ACCOUNTS.BROKER_BUFFER
      : destination === 'TREASURY_USDC'
        ? CASH_ACCOUNTS.TREASURY_USDC
        : CASH_ACCOUNTS.MSB_SETTLED;

  return {
    intentId,
    reference: 'msb.conversion_settled',
    memo: `Converted ${from.currency} to ${to.currency}`,
    cash: [
      credit(CASH_ACCOUNTS.MSB_TRANSIT, from),
      debit(CASH_ACCOUNTS.FX_CLEARING, subtract(from, fee)),
      debit(CASH_ACCOUNTS.EXPENSE_MSB_FEE, fee),
      credit(CASH_ACCOUNTS.FX_CLEARING, to),
      debit(target, to),
    ],
  };
}

/** Value handed to the MSB ahead of a crossing (repatriation leg). */
export function sentToMsb(
  intentId: string | undefined,
  amount: Money,
  from: 'BROKER_PROCEEDS' | 'TREASURY_USDC',
): JournalEntryInput {
  return {
    intentId,
    reference: 'msb.funds_sent',
    memo: 'Funds handed to the money services provider',
    cash: transfer(
      from === 'BROKER_PROCEEDS' ? CASH_ACCOUNTS.BROKER_PROCEEDS : CASH_ACCOUNTS.TREASURY_USDC,
      CASH_ACCOUNTS.MSB_TRANSIT,
      amount,
    ),
  };
}

/** A payout landed in the broker's settlement account. */
export function brokerFunded(intentId: string | undefined, amount: Money): JournalEntryInput {
  return {
    intentId,
    reference: 'msb.broker_funded',
    memo: 'Payout landed in the broker settlement account',
    cash: transfer(CASH_ACCOUNTS.MSB_SETTLED, CASH_ACCOUNTS.BROKER_BUFFER, amount),
  };
}

/* -------------------------------------------------------------------------- */
/* Pre-IPO vault                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A vault deposit landed.
 *
 * The upfront fee comes off the top but is *escrowed*, not earned — a deal
 * cancelled before deployment refunds it with the principal — so the whole
 * gross amount stays a liability to the subscriber for now.
 */
export function vaultDeposit(intentId: string, gross: Money): JournalEntryInput {
  return {
    intentId,
    reference: 'vault.deposit',
    memo: 'Vault subscription received; fee escrowed, not yet earned',
    cash: [
      debit(CASH_ACCOUNTS.CHAIN_ESCROW, gross),
      credit(CASH_ACCOUNTS.VAULT_SUBSCRIPTION, gross),
    ],
  };
}

/**
 * `deploy_capital` sent USDC to the immutable broker destination.
 *
 * This is the moment the upfront fee becomes earned — the program moves it from
 * `fees_escrowed` to `fees_collected` — so it is recognised here and not a
 * moment before.
 */
export function vaultDeployed(
  mandateId: string,
  deployed: Money,
  feeEarned: Money,
): JournalEntryInput {
  return {
    intentId: mandateId,
    reference: 'vault.deployed',
    memo: 'Vault capital deployed to the broker; upfront fee earned',
    cash: [
      credit(CASH_ACCOUNTS.CHAIN_ESCROW, deployed),
      debit(CASH_ACCOUNTS.MSB_TRANSIT, deployed),
      credit(CASH_ACCOUNTS.CHAIN_ESCROW, feeEarned),
      debit(CASH_ACCOUNTS.CHAIN_FEES_RECEIVABLE, feeEarned),
      debit(CASH_ACCOUNTS.VAULT_SUBSCRIPTION, feeEarned),
      credit(CASH_ACCOUNTS.INCOME_SPREAD, feeEarned),
    ],
  };
}

/** The IPO ballot allocated shares; the registrar refunds the unfilled balance. */
export function vaultAllocated(
  mandateId: string,
  allocated: Quantity,
  consideration: Money,
  refund: Money,
): JournalEntryInput {
  return {
    intentId: mandateId,
    reference: 'vault.allocated',
    memo: `Allocated ${allocated.units} ${allocated.ticker}`,
    cash: [
      credit(CASH_ACCOUNTS.BROKER_SETTLEMENT, consideration),
      debit(CASH_ACCOUNTS.FX_CLEARING, consideration),
      ...(refund.amount > 0n
        ? transfer(CASH_ACCOUNTS.BROKER_SETTLEMENT, CASH_ACCOUNTS.BROKER_BUFFER, refund)
        : []),
    ],
    positions: [
      debitShares(POSITION_ACCOUNTS.CUSTODY_INBOUND, allocated),
      creditShares(POSITION_ACCOUNTS.PENDING_ISSUANCE, allocated),
    ],
  };
}

/**
 * `settle`: net cash returned on-chain and redemption opened.
 *
 * Two independent balanced pairs — USDC moves from the treasury float into the
 * on-chain vault, and the subscriber liability reclassifies to a redeemable one.
 */
export function vaultSettled(
  mandateId: string,
  redeemable: Money,
  subscriptionDischarged: Money,
): JournalEntryInput {
  return {
    intentId: mandateId,
    reference: 'vault.settled',
    memo: 'Net proceeds returned on-chain; redemption open',
    cash: [
      credit(CASH_ACCOUNTS.TREASURY_USDC, redeemable),
      debit(CASH_ACCOUNTS.CHAIN_ESCROW, redeemable),
      debit(CASH_ACCOUNTS.VAULT_SUBSCRIPTION, subscriptionDischarged),
      credit(CASH_ACCOUNTS.VAULT_REDEEMABLE, subscriptionDischarged),
    ],
  };
}

/** A holder burned claim tokens for USDC. */
export function vaultClaimed(intentId: string, paid: Money): JournalEntryInput {
  return {
    intentId,
    reference: 'vault.claimed',
    memo: 'Holder redeemed claim tokens for USDC',
    cash: [
      credit(CASH_ACCOUNTS.CHAIN_ESCROW, paid),
      debit(CASH_ACCOUNTS.VAULT_REDEEMABLE, paid),
    ],
  };
}

/** A cancelled vault refunded a subscriber, less disclosed unrefundable costs. */
export function vaultRefunded(
  intentId: string,
  refunded: Money,
  costsBorne: Money,
): JournalEntryInput {
  return {
    intentId,
    reference: 'vault.refunded',
    memo: 'Vault cancelled; principal refunded less pro-rata costs',
    cash: [
      credit(CASH_ACCOUNTS.CHAIN_ESCROW, refunded),
      debit(CASH_ACCOUNTS.VAULT_SUBSCRIPTION, refunded),
      debit(CASH_ACCOUNTS.VAULT_SUBSCRIPTION, costsBorne),
      credit(CASH_ACCOUNTS.CHAIN_ESCROW, costsBorne),
    ],
  };
}

/**
 * A holder elected share delivery. The claim token burns on-chain and the real
 * shares transfer out through the custodian.
 */
export function vaultDeliveryElected(intentId: string, shares: Quantity): JournalEntryInput {
  return {
    intentId,
    reference: 'vault.delivery_elected',
    memo: `Holder elected delivery of ${shares.units} ${shares.ticker}`,
    positions: transferShares(
      POSITION_ACCOUNTS.PENDING_ISSUANCE,
      POSITION_ACCOUNTS.DELIVERY_PENDING,
      shares,
    ),
  };
}

/** The custodian delivered elected shares to the holder's own broker. */
export function vaultDelivered(intentId: string, shares: Quantity): JournalEntryInput {
  return {
    intentId,
    reference: 'custody.delivered',
    memo: `Delivered ${shares.units} ${shares.ticker} to the holder`,
    positions: [
      debitShares(POSITION_ACCOUNTS.DELIVERY_PENDING, shares),
      creditShares(POSITION_ACCOUNTS.CUSTODY_INBOUND, shares),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Treasury                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Move a realised FX residual off the clearing position into income.
 * A positive `result` is a gain.
 */
export function recogniseFxResult(reference: string, result: Money): JournalEntryInput {
  const magnitude = { ...result, amount: result.amount < 0n ? -result.amount : result.amount };
  return {
    reference,
    memo: result.amount >= 0n ? 'Recognised realised FX gain' : 'Recognised realised FX loss',
    cash:
      result.amount >= 0n
        ? [debit(CASH_ACCOUNTS.FX_CLEARING, magnitude), credit(CASH_ACCOUNTS.INCOME_FX, magnitude)]
        : [credit(CASH_ACCOUNTS.FX_CLEARING, magnitude), debit(CASH_ACCOUNTS.INCOME_FX, magnitude)],
  };
}

/** `sweep_fee` moved earned protocol fees on-chain to the treasury. */
export function feeSwept(reference: string, amount: Money): JournalEntryInput {
  return {
    reference,
    memo: 'Swept earned protocol fees to the treasury',
    cash: transfer(CASH_ACCOUNTS.CHAIN_FEES_RECEIVABLE, CASH_ACCOUNTS.TREASURY_USDC, amount),
  };
}

/**
 * Park an unexplained difference to suspense so the books stay balanced while
 * a break is investigated. A non-zero suspense balance is an operational alarm,
 * never a resting state.
 */
export function parkToSuspense(
  reference: string,
  amount: Money,
  counterAccount: (typeof CASH_ACCOUNTS)[keyof typeof CASH_ACCOUNTS],
  memo: string,
): JournalEntryInput {
  return {
    reference,
    memo,
    cash:
      amount.amount >= 0n
        ? transfer(CASH_ACCOUNTS.SUSPENSE, counterAccount, amount)
        : transfer(counterAccount, CASH_ACCOUNTS.SUSPENSE, {
            ...amount,
            amount: -amount.amount,
          }),
  };
}
