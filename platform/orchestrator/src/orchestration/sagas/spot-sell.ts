/**
 * SPOT_SELL — holder burns a position token, ends up with USDC.
 *
 * ```
 *  place_sell (chain, observed — tokens escrowed, NOT burned)
 *      │
 *  screen ─▶ validate_order ─▶ place_order ─▶ await_fill ─▶ reserve_payout
 *                                                                 │
 *                    repatriate ◀── settle_onchain ◀── await_custody_release
 *                    (replenish            (burn +
 *                     the float)         pay trader)
 * ```
 *
 * Two ordering decisions carry the design:
 *
 *   - **Burn after custody releases, not before.** While the broker is selling,
 *     the custodian still holds the share, so supply should still reflect it.
 *     `settle_sell` is the moment the share genuinely leaves custody, and a
 *     cancelled sell returns the position intact.
 *
 *   - **Pay from the USDC float, repatriate afterwards.** The seller is paid as
 *     soon as custody releases rather than waiting on a cross-border HKD→USDC
 *     wire. That is the whole point of holding a float.
 */

import { CounterpartyRejection, RetryableError, ValidationError } from '../../domain/errors.js';
import { documentHash } from '../../domain/ids.js';
import {
  basisPoints,
  convert,
  fxRate,
  lessThan,
  subtract,
  zero,
  type Money,
} from '../../domain/money.js';
import {
  conversionSettled,
  sellFilled,
  sellSettled,
  sentToMsb,
} from '../../ledger/postings.js';
import { tierSatisfies } from '../../ports/compliance.js';
import type { Services } from '../../services.js';
import type { Saga, Step, StepContext, StepResult } from '../runner.js';

type Ctx = StepContext<Services>;

function requireTicker(ctx: Ctx): string {
  const ticker = ctx.intent.request.ticker;
  if (!ticker) throw new ValidationError('SPOT_SELL intent has no ticker', { intentId: ctx.intent.id });
  return ticker;
}

function requireOrderId(ctx: Ctx): string {
  const orderId = ctx.intent.request.orderId;
  if (!orderId) throw new ValidationError('SPOT_SELL intent has no order id', { intentId: ctx.intent.id });
  return orderId;
}

function requireLimitPrice(ctx: Ctx): Money {
  const price = ctx.intent.request.limitPrice;
  if (!price) throw new ValidationError('SPOT_SELL intent has no limit price', { intentId: ctx.intent.id });
  return price;
}

/* -------------------------------------------------------------------------- */

const screen: Step<Services> = {
  name: 'screen',

  async run(ctx): Promise<StepResult> {
    const { compliance, chain } = ctx.services;

    const onChain = await chain.getTraderAccount(ctx.intent.wallet);
    if (!onChain || !onChain.eligible) {
      return { kind: 'UNWIND', reason: `Wallet ${ctx.intent.wallet} is not an eligible trader on-chain` };
    }

    const order = await chain.getSpotOrder(requireTicker(ctx), requireOrderId(ctx));
    if (!order?.escrowedShares) {
      return { kind: 'UNWIND', reason: 'Sell order has no escrowed position on-chain' };
    }

    // Notional is indicative: the fill price is not known yet, and screening
    // thresholds are applied to the order's own limit.
    const indicative: Money = {
      currency: requireLimitPrice(ctx).currency,
      amount: requireLimitPrice(ctx).amount * order.escrowedShares.units,
    };

    const request = {
      wallet: ctx.intent.wallet,
      action: 'SPOT_SELL' as const,
      amount: indicative,
      ticker: ctx.intent.request.ticker,
    };

    const [verification, requiredTier, screening] = await Promise.all([
      compliance.getVerification(ctx.intent.wallet),
      compliance.requiredTier('SPOT_SELL', indicative),
      compliance.screen(request),
    ]);

    if (!verification || verification.status !== 'VERIFIED') {
      return { kind: 'UNWIND', reason: `Wallet ${ctx.intent.wallet} has no current verification` };
    }
    if (!tierSatisfies(verification.tier, requiredTier)) {
      return { kind: 'UNWIND', reason: `Sale requires ${requiredTier}; wallet holds ${verification.tier}` };
    }
    if (screening.decision === 'BLOCK') {
      return {
        kind: 'UNWIND',
        reason: `Screening blocked the sale: ${screening.reasons.join('; ')}`,
        facts: { screeningId: screening.screeningId, screeningDecision: 'BLOCK' },
      };
    }
    if (screening.decision === 'REVIEW') {
      return {
        kind: 'MANUAL',
        reason: `Screening flagged the sale for review: ${screening.reasons.join('; ')}`,
        facts: { screeningId: screening.screeningId, screeningDecision: 'REVIEW' },
      };
    }

    return {
      kind: 'ADVANCE',
      facts: { screeningId: screening.screeningId, screeningDecision: 'CLEAR' },
    };
  },
};

const validateOrder: Step<Services> = {
  name: 'validate_order',

  async run(ctx): Promise<StepResult> {
    const { broker, chain, custodian, config } = ctx.services;
    const ticker = requireTicker(ctx);

    const [order, instrument, position] = await Promise.all([
      chain.getSpotOrder(ticker, requireOrderId(ctx)),
      broker.getInstrument(ticker),
      custodian.getPosition(config.accounts.custodyRef, ticker),
    ]);

    if (!order) return { kind: 'UNWIND', reason: 'Sell order not found on-chain' };
    if (order.state === 'CANCELLED') return { kind: 'UNWIND', reason: 'Sell order was cancelled on-chain' };
    if (!instrument) return { kind: 'UNWIND', reason: `Broker does not list ${ticker}` };
    if (!order.escrowedShares) return { kind: 'UNWIND', reason: 'Sell order has no escrowed position' };

    if (instrument.status === 'DELISTED') {
      return {
        kind: 'MANUAL',
        reason: `${ticker} is delisted. The position cannot be sold on-exchange and needs a corporate-action path.`,
      };
    }
    if (instrument.status !== 'TRADING') {
      return { kind: 'WAIT', reason: `${ticker} is ${instrument.status}`, retryAfterMillis: 60_000 };
    }

    // We cannot sell shares the custodian does not hold. If this fails, the 1:1
    // backing invariant is already broken and selling would compound it.
    if (!position || position.settled.units < order.escrowedShares.units) {
      return {
        kind: 'MANUAL',
        reason:
          `Custodian holds ${position?.settled.units ?? 0n} ${ticker} but the sale needs ` +
          `${order.escrowedShares.units}. Reconcile before selling.`,
      };
    }

    return { kind: 'ADVANCE' };
  },
};

const placeOrder: Step<Services> = {
  name: 'place_order',

  async run(ctx): Promise<StepResult> {
    const { broker, chain, config } = ctx.services;
    const ticker = requireTicker(ctx);

    const existing = await broker.getOrder(ctx.clientRef);
    if (existing) {
      return { kind: 'ADVANCE', facts: { brokerClientOrderId: ctx.clientRef } };
    }

    const order = await chain.getSpotOrder(ticker, requireOrderId(ctx));
    if (!order?.escrowedShares) {
      throw new RetryableError({
        code: 'order_unavailable',
        message: `Could not read the escrowed position for ${ticker}`,
      });
    }

    const placed = await broker.placeOrder({
      clientOrderId: ctx.clientRef,
      ticker,
      side: 'SELL',
      quantity: order.escrowedShares,
      limitPrice: requireLimitPrice(ctx),
      timeInForce: 'DAY',
      accountRef: config.accounts.brokerRef,
    });

    if (placed.status === 'REJECTED') {
      throw new CounterpartyRejection('broker', placed.rejectReason ?? 'unknown', {
        clientOrderId: ctx.clientRef,
      });
    }

    return {
      kind: 'ADVANCE',
      facts: { brokerClientOrderId: ctx.clientRef, brokerOrderId: placed.brokerOrderId ?? undefined },
    };
  },

  async resolve(ctx): Promise<StepResult | null> {
    const existing = await ctx.services.broker.getOrder(ctx.clientRef);
    if (!existing) return null;
    if (existing.status === 'REJECTED') {
      return { kind: 'UNWIND', reason: `Broker rejected the sale: ${existing.rejectReason}` };
    }
    return { kind: 'ADVANCE', facts: { brokerClientOrderId: ctx.clientRef } };
  },

  async compensate(ctx): Promise<void> {
    const existing = await ctx.services.broker.getOrder(ctx.clientRef);
    if (existing && (existing.status === 'NEW' || existing.status === 'PENDING_NEW')) {
      await ctx.services.broker.cancelOrder(ctx.clientRef);
    }
  },
};

const awaitFill: Step<Services> = {
  name: 'await_fill',

  async run(ctx): Promise<StepResult> {
    const { broker, ledger, chain, config } = ctx.services;
    const clientOrderId = ctx.facts.brokerClientOrderId;
    if (!clientOrderId) {
      throw new ValidationError('await_fill reached without a broker order', { intentId: ctx.intent.id });
    }

    const order = await broker.getOrder(clientOrderId);
    if (!order) {
      throw new RetryableError({
        code: 'broker_order_missing',
        message: `Broker order ${clientOrderId} could not be read back`,
      });
    }

    if (order.status === 'REJECTED') {
      return { kind: 'UNWIND', reason: `Broker rejected the sale: ${order.rejectReason}` };
    }
    if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
      if (order.filledQuantity.units === 0n) {
        return { kind: 'UNWIND', reason: `Sale ${order.status.toLowerCase()} with no fill` };
      }
    } else if (order.status !== 'FILLED') {
      return { kind: 'WAIT', reason: `Sale is ${order.status}` };
    }

    if (!order.grossConsideration || !order.averagePrice || order.filledQuantity.units === 0n) {
      return { kind: 'UNWIND', reason: 'Sale completed with no executable quantity' };
    }

    // A fill below the trader's limit is a worse price for a seller.
    if (lessThan(order.averagePrice, requireLimitPrice(ctx))) {
      return {
        kind: 'MANUAL',
        reason:
          `Average fill ${order.averagePrice.amount} is below the seller's limit ` +
          `${requireLimitPrice(ctx).amount}.`,
      };
    }

    const market = await chain.getMarket(requireTicker(ctx));
    const spreadBps = market?.feeBps ?? config.defaultSpreadBps;
    const spreadHkd = basisPoints(order.grossConsideration, spreadBps, 'DOWN');

    await ledger.post(
      sellFilled(
        ctx.intent.id,
        order.grossConsideration,
        order.totalCommission,
        order.totalLevies,
        spreadHkd,
        order.filledQuantity,
      ),
    );

    return {
      kind: 'ADVANCE',
      facts: {
        filledQuantity: order.filledQuantity,
        averagePrice: order.averagePrice,
        grossConsideration: order.grossConsideration,
        brokerCommission: order.totalCommission,
        brokerLevies: order.totalLevies,
        brokerTradeReference: order.tradeReference ?? undefined,
        spreadEarned: spreadHkd,
      },
    };
  },
};

/**
 * Hold USDC from the float so the seller can be paid the moment custody
 * releases, rather than after the HKD repatriation lands.
 *
 * If the float cannot cover it we do not fail: we mark the intent to wait for
 * repatriation instead, which is slower for the seller but always correct.
 */
const reservePayout: Step<Services> = {
  name: 'reserve_payout',

  async run(ctx): Promise<StepResult> {
    const { treasury, msb } = ctx.services;
    const gross = ctx.facts.grossConsideration;
    const spread = ctx.facts.spreadEarned;
    if (!gross || !spread) {
      throw new ValidationError('reserve_payout reached without fill economics', {
        intentId: ctx.intent.id,
      });
    }

    const owedHkd = subtract(gross, spread);
    const quote = await msb.quoteConversion(owedHkd, 'USDC');
    const owedUsdc = quote.to;

    if (await treasury.canFund(owedUsdc)) {
      const reservation = await treasury.reserve(ctx.intent.id, owedUsdc);
      return {
        kind: 'ADVANCE',
        facts: { reservationId: reservation.id, reservedAmount: owedUsdc, justInTime: false },
      };
    }

    ctx.logger.warn(
      { required: owedUsdc.amount.toString() },
      'USDC float cannot cover the payout; seller will be paid after repatriation',
    );
    return { kind: 'ADVANCE', facts: { reservedAmount: owedUsdc, justInTime: true } };
  },

  async compensate(ctx): Promise<void> {
    if (ctx.facts.reservationId) {
      await ctx.services.treasury.release(ctx.facts.reservationId);
    }
  },
};

/**
 * Wait for the custodian to release the shares.
 *
 * Deliberately blocking: burning the position token before the share has left
 * custody would make token supply understate custodied holdings, which is the
 * exact invariant the position ledger exists to protect.
 */
const awaitCustodyRelease: Step<Services> = {
  name: 'await_custody_release',

  async run(ctx): Promise<StepResult> {
    const { custodian } = ctx.services;
    const tradeReference = ctx.facts.brokerTradeReference;
    if (!tradeReference) {
      return {
        kind: 'MANUAL',
        reason: 'The sale carried no trade reference, so custody cannot be matched to it',
      };
    }

    const settlement = await custodian.getSettlementByTrade(tradeReference);
    if (!settlement) {
      return { kind: 'WAIT', reason: 'Custodian has not acknowledged the sale yet', retryAfterMillis: 60_000 };
    }
    if (settlement.status === 'FAILED') {
      return {
        kind: 'MANUAL',
        reason: `Sale settlement failed at the custodian: ${settlement.failureReason ?? 'unknown'}`,
      };
    }
    if (settlement.status !== 'SETTLED') {
      return { kind: 'WAIT', reason: `Sale settlement is ${settlement.status}`, retryAfterMillis: 60_000 };
    }

    // `settle_sell` rejects a zeroed document hash, so the sale must be
    // evidenced before the tokens can burn — the same standard `confirm_buy`
    // applies to minting. Fetching the document here rather than at settlement
    // keeps the on-chain step free of I/O that can fail after the burn.
    if (!settlement.documentRef) {
      return {
        kind: 'MANUAL',
        reason: 'Custodian released the shares without a settlement document to evidence it',
      };
    }

    const document = await custodian.getDocument(settlement.documentRef);
    if (!document) {
      throw new RetryableError({
        code: 'custody_document_unavailable',
        message: `Document ${settlement.documentRef} could not be fetched`,
      });
    }

    return {
      kind: 'ADVANCE',
      facts: {
        custodySettlementId: settlement.settlementId,
        documentRef: settlement.documentRef,
        documentHash: documentHash(document.bytes),
      },
    };
  },
};

/** `settle_sell`: burn the escrowed tokens and pay the seller net of spread. */
const settleOnChain: Step<Services> = {
  name: 'settle_onchain',

  async run(ctx): Promise<StepResult> {
    const { chain, ledger, treasury, msb } = ctx.services;
    const gross = ctx.facts.grossConsideration;
    const spread = ctx.facts.spreadEarned;
    const filled = ctx.facts.filledQuantity;
    if (!gross || !spread || !filled) {
      throw new ValidationError('settle_onchain reached without fill economics', {
        intentId: ctx.intent.id,
      });
    }

    const owedHkd = subtract(gross, spread);

    // On the slow path the float could not cover the payout, so we must wait
    // for the repatriated USDC to arrive before we can pay anything out.
    if (ctx.facts.justInTime === true && !(await treasury.canFund(await usdcOwed(ctx, owedHkd)))) {
      return { kind: 'WAIT', reason: 'Waiting for USDC to repatriate before paying the seller', retryAfterMillis: 60_000 };
    }

    const quote = await msb.quoteConversion(owedHkd, 'USDC');
    const grossUsdc = quote.to;

    const { averagePrice, documentHash: hash } = ctx.facts;
    if (!averagePrice || !hash) {
      throw new ValidationError('settle_onchain reached without an evidenced execution', {
        intentId: ctx.intent.id,
      });
    }

    const result = await chain.settleSell({
      orderId: requireOrderId(ctx),
      ticker: requireTicker(ctx),
      grossProceeds: grossUsdc,
      quantity: filled,
      executionPrice: averagePrice,
      documentHash: hash,
    });

    if (!result.alreadyApplied) {
      await ledger.post(sellSettled(ctx.intent.id, grossUsdc, owedHkd, filled));
    }

    if (ctx.facts.reservationId) {
      await treasury.consume(ctx.facts.reservationId);
    }

    return {
      kind: 'ADVANCE',
      facts: { settleSignature: result.signature, netProceeds: grossUsdc },
    };
  },

  async resolve(ctx): Promise<StepResult | null> {
    const order = await ctx.services.chain.getSpotOrder(requireTicker(ctx), requireOrderId(ctx));
    if (!order) return null;
    if (order.state !== 'SETTLED') return null;

    const gross = ctx.facts.grossConsideration;
    const spread = ctx.facts.spreadEarned;
    const filled = ctx.facts.filledQuantity;
    if (!gross || !spread || !filled) return null;

    if (!ctx.facts.settleSignature) {
      const owedHkd = subtract(gross, spread);
      const quote = await ctx.services.msb.quoteConversion(owedHkd, 'USDC');
      await ctx.services.ledger.post(sellSettled(ctx.intent.id, quote.to, owedHkd, filled));
    }
    return { kind: 'ADVANCE', facts: {} };
  },
};

/** Bring the HKD proceeds home and replenish the USDC float. */
const repatriate: Step<Services> = {
  name: 'repatriate',

  async run(ctx): Promise<StepResult> {
    const { msb, ledger } = ctx.services;
    const gross = ctx.facts.grossConsideration;
    const commission = ctx.facts.brokerCommission;
    const levies = ctx.facts.brokerLevies;
    if (!gross) {
      throw new ValidationError('repatriate reached without proceeds', { intentId: ctx.intent.id });
    }

    const cashAtBroker = subtract(
      subtract(gross, commission ?? zero(gross.currency)),
      levies ?? zero(gross.currency),
    );

    const conversionRef = `${ctx.clientRef}.conversion`;
    let conversion = await msb.getConversion(conversionRef);
    if (!conversion) {
      await ledger.post(sentToMsb(ctx.intent.id, cashAtBroker, 'BROKER_PROCEEDS'));
      conversion = await msb.createConversion({
        clientRef: conversionRef,
        from: cashAtBroker,
        to: 'USDC',
        purpose: 'TREASURY_REPATRIATION',
      });
    }

    if (conversion.status === 'FAILED' || conversion.status === 'CANCELLED') {
      return {
        kind: 'MANUAL',
        reason:
          `HKD→USDC repatriation failed (${conversion.failureReason ?? conversion.status}). ` +
          `The seller has already been paid from the float, so the float is short until this is fixed.`,
        facts: { conversionRef },
      };
    }

    if (conversion.status !== 'SETTLED' || !conversion.to) {
      // Carry the reference forward. A waiting intent an operator cannot trace
      // to a specific conversion is an operational dead end.
      return {
        kind: 'WAIT',
        reason: 'Waiting for the HKD→USDC repatriation to settle',
        retryAfterMillis: 60_000,
        facts: { conversionRef, conversionId: conversion.id },
      };
    }

    await ledger.post(
      conversionSettled(
        ctx.intent.id,
        conversion.from,
        conversion.to,
        conversion.fee ?? zero(conversion.from.currency),
        'TREASURY_USDC',
      ),
    );

    return { kind: 'ADVANCE', facts: { conversionRef, convertedAmount: conversion.to } };
  },

  async resolve(ctx): Promise<StepResult | null> {
    const conversion = await ctx.services.msb.getConversion(`${ctx.clientRef}.conversion`);
    if (!conversion) return null;
    return repatriate.run(ctx);
  },
};

/** Indicative USDC value of an HKD amount, for the float sufficiency check. */
async function usdcOwed(ctx: Ctx, owedHkd: Money): Promise<Money> {
  try {
    const quote = await ctx.services.msb.quoteConversion(owedHkd, 'USDC');
    return quote.to;
  } catch {
    // A quote failure must not decide a payout path. Fall back to a
    // deliberately conservative peg so we err towards waiting, not overdrawing.
    return convert(owedHkd, fxRate('HKD', 'USDC', '0.128'), 'DOWN');
  }
}

export const spotSellSaga: Saga<Services> = {
  kind: 'SPOT_SELL',
  steps: [
    screen,
    validateOrder,
    placeOrder,
    awaitFill,
    reservePayout,
    awaitCustodyRelease,
    settleOnChain,
    repatriate,
  ],
};

export const spotSellSteps = {
  screen,
  validateOrder,
  placeOrder,
  awaitFill,
  reservePayout,
  awaitCustodyRelease,
  settleOnChain,
  repatriate,
};
