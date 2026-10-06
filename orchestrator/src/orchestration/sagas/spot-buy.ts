/**
 * SPOT_BUY — trader pays USDC, ends up owning a real HKEX share.
 *
 * ```
 *  place_buy (chain, observed)
 *      │
 *  screen ─▶ validate_order ─▶ reserve_funding ─▶ deploy_escrow
 *                                    │                  │
 *                       buffer ──────┤                  │  USDC leaves the
 *                       or JIT       │                  │  escrow to the MSB
 *                                    ▼                  ▼
 *                              fund_execution ─▶ place_order ─▶ await_fill
 *                                                                    │
 *                        settle_crossing ◀───────────────────────────┘
 *                                    │
 *                        await_custody ─▶ attest_and_mint  (confirm_buy mints)
 * ```
 *
 * The hybrid funding model lives in `reserve_funding` and `fund_execution`.
 * When the working buffer can cover the order, `fund_execution` fires the
 * USDC→HKD crossing and returns immediately, so `place_order` reaches the
 * market in seconds rather than after a cross-border wire. When it cannot, the
 * same step blocks until the crossing and the payout have both landed. Nothing
 * downstream knows or cares which path was taken.
 *
 * The invariant the whole saga serves: **a position token is never minted on
 * the strength of a payment.** `attest_and_mint` requires a custodian position
 * reference and a document hash, and the program rejects zeroed values.
 */

import {
  CounterpartyRejection,
  RetryableError,
  ValidationError,
} from '../../domain/errors.js';
import { documentHash } from '../../domain/ids.js';
import {
  basisPoints,
  greaterThan,
  notional,
  quantity,
  subtract,
  zero,
  type Money,
  type Quantity,
} from '../../domain/money.js';
import { tierSatisfies } from '../../ports/compliance.js';
import { mintBlockedReason, openBackingBreak } from '../../recon/safety.js';
import {
  buyDeployed,
  buyFilled,
  buyMinted,
  brokerFunded,
  conversionSettled,
  custodySettled,
} from '../../ledger/postings.js';
import type { Services } from '../../services.js';
import type { Saga, Step, StepContext, StepResult } from '../runner.js';

type Ctx = StepContext<Services>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function requireTicker(ctx: Ctx): string {
  const ticker = ctx.intent.request.ticker;
  if (!ticker) throw new ValidationError('SPOT_BUY intent has no ticker', { intentId: ctx.intent.id });
  return ticker;
}

function requireOrderId(ctx: Ctx): string {
  const orderId = ctx.intent.request.orderId;
  if (!orderId) throw new ValidationError('SPOT_BUY intent has no order id', { intentId: ctx.intent.id });
  return orderId;
}

function requireEscrowed(ctx: Ctx): Money {
  const amount = ctx.intent.request.amount;
  if (!amount) throw new ValidationError('SPOT_BUY intent has no escrowed amount', { intentId: ctx.intent.id });
  return amount;
}

function requireLimitPrice(ctx: Ctx): Money {
  const price = ctx.intent.request.limitPrice;
  if (!price) throw new ValidationError('SPOT_BUY intent has no limit price', { intentId: ctx.intent.id });
  return price;
}

/** Shares we can actually trade: the request rounded down to a whole board lot. */
function tradableQuantity(requested: Quantity, lotSize: bigint): Quantity {
  if (lotSize <= 0n) return requested;
  return quantity(requested.ticker, (requested.units / lotSize) * lotSize);
}

/**
 * The market's spread in basis points. The on-chain value is authoritative;
 * config only supplies a fallback for a market we cannot read.
 */
async function marketFeeBps(ctx: Ctx): Promise<number> {
  const market = await ctx.services.chain.getMarket(requireTicker(ctx));
  return market?.feeBps ?? ctx.services.config.defaultSpreadBps;
}

/** HKD needed to fund the order, with headroom for commission and slippage. */
function fundingRequirement(qty: Quantity, limitPrice: Money, headroomBps: number): Money {
  const gross = notional(qty, limitPrice, 'UP');
  return {
    currency: gross.currency,
    amount: gross.amount + basisPoints(gross, headroomBps, 'UP').amount,
  };
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Eligibility, sanctions screening and velocity limits.
 *
 * On-chain eligibility is checked first and is authoritative: `register_trader`
 * records it, and a revoked trader must not get a fill even if our local
 * account record is stale.
 */
const screen: Step<Services> = {
  name: 'screen',

  async run(ctx): Promise<StepResult> {
    const { compliance, chain } = ctx.services;
    const amount = requireEscrowed(ctx);

    const onChain = await chain.getTraderAccount(ctx.intent.wallet);
    if (!onChain || !onChain.eligible) {
      return {
        kind: 'UNWIND',
        reason: `Wallet ${ctx.intent.wallet} is not a registered, eligible trader on-chain`,
      };
    }

    const request = {
      wallet: ctx.intent.wallet,
      action: 'SPOT_BUY' as const,
      amount,
      ticker: ctx.intent.request.ticker,
    };

    const [verification, requiredTier, screening, limits] = await Promise.all([
      compliance.getVerification(ctx.intent.wallet),
      compliance.requiredTier('SPOT_BUY', amount),
      compliance.screen(request),
      compliance.assessLimits(request),
    ]);

    if (!verification || verification.status !== 'VERIFIED') {
      return { kind: 'UNWIND', reason: `Wallet ${ctx.intent.wallet} has no current verification` };
    }

    if (!tierSatisfies(verification.tier, requiredTier)) {
      return {
        kind: 'UNWIND',
        reason: `Order requires ${requiredTier}; wallet holds ${verification.tier}`,
      };
    }

    if (screening.decision === 'BLOCK') {
      return {
        kind: 'UNWIND',
        reason: `Screening blocked the order: ${screening.reasons.join('; ')}`,
        facts: { screeningId: screening.screeningId, screeningDecision: 'BLOCK' },
      };
    }

    if (screening.decision === 'REVIEW') {
      // Deliberately parked rather than unwound. A review hit is a question for
      // a compliance officer, not an automatic rejection of the trader.
      return {
        kind: 'MANUAL',
        reason: `Screening flagged the order for review: ${screening.reasons.join('; ')}`,
        facts: { screeningId: screening.screeningId, screeningDecision: 'REVIEW' },
      };
    }

    if (!limits.withinLimits) {
      return { kind: 'UNWIND', reason: `Order exceeds account limits: ${limits.reasons.join('; ')}` };
    }

    return {
      kind: 'ADVANCE',
      facts: { screeningId: screening.screeningId, screeningDecision: 'CLEAR' },
    };
  },
};

/**
 * The market must be open, the name tradable, and the order still live.
 *
 * Quantity is rounded down to a whole board lot here rather than at the broker,
 * so the shortfall is visible in our own record instead of surfacing as an
 * opaque exchange rejection.
 */
const validateOrder: Step<Services> = {
  name: 'validate_order',

  async run(ctx): Promise<StepResult> {
    const { broker, chain } = ctx.services;
    const ticker = requireTicker(ctx);
    const orderId = requireOrderId(ctx);

    const [market, order, instrument] = await Promise.all([
      chain.getMarket(ticker),
      chain.getSpotOrder(ticker, orderId),
      broker.getInstrument(ticker),
    ]);

    if (!market) return { kind: 'UNWIND', reason: `No on-chain market for ${ticker}` };
    if (!order) return { kind: 'UNWIND', reason: `Order ${orderId} not found on-chain` };
    if (order.state === 'CANCELLED') {
      return { kind: 'UNWIND', reason: `Order ${orderId} was already cancelled on-chain` };
    }
    if (!instrument) return { kind: 'UNWIND', reason: `Broker does not list ${ticker}` };

    if (instrument.status === 'DELISTED' || instrument.status === 'SUSPENDED') {
      return { kind: 'UNWIND', reason: `${ticker} is ${instrument.status.toLowerCase()}` };
    }
    if (instrument.status !== 'TRADING') {
      // A halt is temporary. Wait it out rather than cancelling a live order —
      // the on-chain program treats a halt the same way.
      return { kind: 'WAIT', reason: `${ticker} is halted`, retryAfterMillis: 60_000 };
    }

    const tradable = tradableQuantity(order.requestedQuantity, instrument.lotSize);
    if (tradable.units === 0n) {
      return {
        kind: 'UNWIND',
        reason:
          `Requested ${order.requestedQuantity.units} ${ticker} is below the ` +
          `${instrument.lotSize}-share board lot`,
      };
    }

    return { kind: 'ADVANCE' };
  },
};

/**
 * Try to fund from the working buffer; fall back to just-in-time.
 *
 * Reserving is safe here because the trader's USDC is already locked in the
 * on-chain escrow and the program can only ever release it to the immutable
 * conversion-partner account. The buffer draw is collateralised, not
 * speculative.
 */
const reserveFunding: Step<Services> = {
  name: 'reserve_funding',

  async run(ctx): Promise<StepResult> {
    const { treasury, broker, chain, msb, config } = ctx.services;
    const ticker = requireTicker(ctx);
    const orderId = requireOrderId(ctx);
    const limitPrice = requireLimitPrice(ctx);

    const [order, instrument] = await Promise.all([
      chain.getSpotOrder(ticker, orderId),
      broker.getInstrument(ticker),
    ]);
    if (!order || !instrument) {
      throw new RetryableError({
        code: 'reference_data_unavailable',
        message: `Could not read the order or instrument for ${ticker}`,
      });
    }

    // Size the order to what the trader actually paid for. Buying more than the
    // escrow covers would leave Marco funding the difference, and the program
    // would refuse to attest a notional above the capital deployed anyway.
    const escrowed = requireEscrowed(ctx);
    const spread = basisPoints(escrowed, instrument ? await marketFeeBps(ctx) : 0, 'DOWN');
    const spendable = subtract(escrowed, spread);
    const spendableHkd = (await msb.quoteConversion(spendable, 'HKD')).to;

    const affordableUnits = limitPrice.amount > 0n ? spendableHkd.amount / limitPrice.amount : 0n;
    const requested = tradableQuantity(order.requestedQuantity, instrument.lotSize);
    const affordable = tradableQuantity(quantity(ticker, affordableUnits), instrument.lotSize);
    const planned = quantity(
      ticker,
      requested.units < affordable.units ? requested.units : affordable.units,
    );

    if (planned.units === 0n) {
      return {
        kind: 'UNWIND',
        reason:
          `Escrow of ${escrowed.amount} ${escrowed.currency} buys ${affordableUnits} ${ticker} ` +
          `at the ${limitPrice.amount} limit, which is below the ${instrument.lotSize}-share board lot`,
      };
    }

    if (planned.units < requested.units) {
      ctx.logger.warn(
        { requested: requested.units.toString(), planned: planned.units.toString() },
        'Order sized down to what the escrow covers at the limit price',
      );
    }

    const required = fundingRequirement(planned, limitPrice, config.fundingHeadroomBps);

    if (await treasury.canFund(required)) {
      const reservation = await treasury.reserve(ctx.intent.id, required);
      ctx.logger.info(
        { reservationId: reservation.id, amount: required.amount.toString() },
        'Funded from the working buffer',
      );
      return {
        kind: 'ADVANCE',
        facts: {
          plannedQuantity: planned,
          reservationId: reservation.id,
          reservedAmount: required,
          justInTime: false,
        },
      };
    }

    ctx.logger.warn(
      { required: required.amount.toString() },
      'Buffer cannot cover the order; falling back to just-in-time funding',
    );
    return {
      kind: 'ADVANCE',
      facts: { plannedQuantity: planned, reservedAmount: required, justInTime: true },
    };
  },

  async compensate(ctx): Promise<void> {
    if (ctx.facts.reservationId) {
      await ctx.services.treasury.release(ctx.facts.reservationId);
    }
  },
};

/**
 * `deploy_buy`: escrowed USDC leaves for the conversion partner and the program
 * earns its spread.
 *
 * The chain gateway is idempotent by on-chain state, so a resume that re-enters
 * this step reads the order as already Deployed and returns without
 * resubmitting.
 */
const deployEscrow: Step<Services> = {
  name: 'deploy_escrow',

  async run(ctx): Promise<StepResult> {
    const { chain, ledger, config } = ctx.services;
    const ticker = requireTicker(ctx);
    const orderId = requireOrderId(ctx);
    const escrowed = requireEscrowed(ctx);

    const market = await chain.getMarket(ticker);
    const feeBps = market?.feeBps ?? config.defaultSpreadBps;
    const spread = basisPoints(escrowed, feeBps, 'DOWN');

    const result = await chain.deployBuy(ticker, orderId);

    if (!result.alreadyApplied) {
      await ledger.post(buyDeployed(ctx.intent.id, escrowed, spread));
    }

    return {
      kind: 'ADVANCE',
      facts: { deploySignature: result.signature, spreadEarned: spread },
    };
  },

  /**
   * A submission we lost track of may still have confirmed. Read the order
   * state rather than resubmitting: `deploy_buy` moves real money.
   */
  async resolve(ctx): Promise<StepResult | null> {
    const { chain, ledger, config } = ctx.services;
    const ticker = requireTicker(ctx);
    const order = await chain.getSpotOrder(ticker, requireOrderId(ctx));
    if (!order) return null;

    if (order.state === 'PENDING') {
      // It definitively did not land. Safe to run the step again.
      return null;
    }
    if (order.state === 'CANCELLED') {
      return { kind: 'UNWIND', reason: 'Order was cancelled on-chain while deploying' };
    }

    const escrowed = requireEscrowed(ctx);
    const market = await chain.getMarket(ticker);
    const spread = basisPoints(escrowed, market?.feeBps ?? config.defaultSpreadBps, 'DOWN');
    if (!ctx.facts.deploySignature) {
      await ledger.post(buyDeployed(ctx.intent.id, escrowed, spread));
    }
    return { kind: 'ADVANCE', facts: { spreadEarned: spread } };
  },
};

/**
 * Cross USDC to HKD and, on the just-in-time path, wait for the broker to be
 * funded before the order is allowed anywhere near the market.
 *
 * Re-entrant: each pass re-reads the conversion and payout by their
 * deterministic references and decides what still needs doing.
 */
const fundExecution: Step<Services> = {
  name: 'fund_execution',

  async run(ctx): Promise<StepResult> {
    const { msb } = ctx.services;
    const escrowed = requireEscrowed(ctx);
    const spread = ctx.facts.spreadEarned ?? zero(escrowed.currency);
    const crossingAmount = subtract(escrowed, spread);

    const conversionRef = `${ctx.clientRef}.conversion`;

    let conversion = await msb.getConversion(conversionRef);
    if (!conversion) {
      conversion = await msb.createConversion({
        clientRef: conversionRef,
        from: crossingAmount,
        to: 'HKD',
        purpose: 'SECURITIES_SETTLEMENT',
      });
    }

    if (conversion.status === 'FAILED' || conversion.status === 'CANCELLED') {
      return {
        kind: 'UNWIND',
        reason: `USDC→HKD crossing failed: ${conversion.failureReason ?? conversion.status}`,
        facts: { conversionRef },
      };
    }

    // Buffer path: the order is already funded, so do not block on the wire.
    // The crossing is replenishment and `settle_crossing` picks it up later.
    if (ctx.facts.justInTime !== true) {
      return { kind: 'ADVANCE', facts: { conversionRef, conversionId: conversion.id } };
    }

    if (conversion.status !== 'SETTLED' || !conversion.to) {
      return {
        kind: 'WAIT',
        reason: 'Waiting for the USDC→HKD crossing to settle',
        facts: { conversionRef, conversionId: conversion.id },
      };
    }

    const payoutRef = `${ctx.clientRef}.payout`;
    let payout = await msb.getPayout(payoutRef);
    if (!payout) {
      payout = await msb.createPayout({
        clientRef: payoutRef,
        amount: conversion.to,
        destination: {
          rail: 'BANK',
          beneficiaryId: ctx.services.config.accounts.brokerRef,
          reference: ctx.intent.id,
        },
        purpose: 'SECURITIES_SETTLEMENT',
      });
    }

    if (payout.status === 'FAILED' || payout.status === 'RETURNED') {
      return {
        kind: 'UNWIND',
        reason: `Broker funding failed: ${payout.failureReason ?? payout.status}`,
        facts: { conversionRef, payoutRef },
      };
    }

    if (payout.status !== 'SETTLED') {
      return {
        kind: 'WAIT',
        reason: 'Waiting for the payout to reach the broker',
        facts: { conversionRef, payoutRef, convertedAmount: conversion.to },
      };
    }

    return {
      kind: 'ADVANCE',
      facts: {
        conversionRef,
        conversionId: conversion.id,
        convertedAmount: conversion.to,
        payoutRef,
        payoutId: payout.id,
        fxRateDecimal: conversion.rate
          ? `${conversion.rate.numerator}/${conversion.rate.denominator}`
          : undefined,
      },
    };
  },

  /**
   * Query by clientRef — never create a second conversion or payout.
   *
   * If the conversion exists, re-running is safe: every branch below looks the
   * operation up before creating anything.
   */
  async resolve(ctx): Promise<StepResult | null> {
    const conversion = await ctx.services.msb.getConversion(`${ctx.clientRef}.conversion`);
    if (!conversion) return null;
    return fundExecution.run(ctx);
  },
};

/** Place the limit order. Limit only: the program rejects a worse-than-agreed fill. */
const placeOrder: Step<Services> = {
  name: 'place_order',

  async run(ctx): Promise<StepResult> {
    const { broker, chain, config } = ctx.services;
    const ticker = requireTicker(ctx);
    const orderId = requireOrderId(ctx);

    const existing = await broker.getOrder(ctx.clientRef);
    if (existing) {
      return { kind: 'ADVANCE', facts: { brokerClientOrderId: ctx.clientRef, brokerOrderId: existing.brokerOrderId ?? undefined } };
    }

    const planned = ctx.facts.plannedQuantity;
    if (!planned) {
      throw new ValidationError('place_order reached without a planned quantity', {
        intentId: ctx.intent.id,
      });
    }

    const order = await chain.getSpotOrder(ticker, orderId);
    if (!order) {
      throw new RetryableError({
        code: 'reference_data_unavailable',
        message: `Could not read the order for ${ticker}`,
      });
    }
    if (order.state === 'CANCELLED') {
      return { kind: 'UNWIND', reason: 'Order was cancelled on-chain before placement' };
    }

    const placed = await broker.placeOrder({
      clientOrderId: ctx.clientRef,
      ticker,
      side: 'BUY',
      quantity: planned,
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
      return { kind: 'UNWIND', reason: `Broker rejected the order: ${existing.rejectReason}` };
    }
    return {
      kind: 'ADVANCE',
      facts: { brokerClientOrderId: ctx.clientRef, brokerOrderId: existing.brokerOrderId ?? undefined },
    };
  },

  /**
   * Cancel a resting order during an unwind. A filled order cannot be cancelled
   * and must not be treated as if it were — the compensation is a no-op and the
   * position is reconciled instead.
   */
  async compensate(ctx): Promise<void> {
    const existing = await ctx.services.broker.getOrder(ctx.clientRef);
    if (!existing) return;
    if (existing.status === 'NEW' || existing.status === 'PENDING_NEW') {
      await ctx.services.broker.cancelOrder(ctx.clientRef);
    }
  },
};

/** Wait for the fill and book the cash and share legs. */
const awaitFill: Step<Services> = {
  name: 'await_fill',

  async run(ctx): Promise<StepResult> {
    const { broker, ledger } = ctx.services;
    const clientOrderId = ctx.facts.brokerClientOrderId;
    if (!clientOrderId) {
      throw new ValidationError('await_fill reached without a broker order', {
        intentId: ctx.intent.id,
      });
    }

    const order = await broker.getOrder(clientOrderId);
    if (!order) {
      throw new RetryableError({
        code: 'broker_order_missing',
        message: `Broker order ${clientOrderId} could not be read back`,
      });
    }

    if (order.status === 'REJECTED') {
      return { kind: 'UNWIND', reason: `Broker rejected the order: ${order.rejectReason}` };
    }

    if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
      if (order.filledQuantity.units === 0n) {
        return { kind: 'UNWIND', reason: `Order ${order.status.toLowerCase()} with no fill` };
      }
      // Partially filled then expired: proceed with what we actually got.
    } else if (order.status !== 'FILLED') {
      return { kind: 'WAIT', reason: `Order is ${order.status}` };
    }

    if (order.filledQuantity.units === 0n || !order.averagePrice || !order.grossConsideration) {
      return { kind: 'UNWIND', reason: 'Order completed with no executable quantity' };
    }

    // A fill larger than we ordered means the broker and our record disagree
    // about the order. Minting the excess would create tokens the trader never
    // paid for, so this stops rather than reconciling itself.
    const planned = ctx.facts.plannedQuantity;
    if (planned && order.filledQuantity.units > planned.units) {
      return {
        kind: 'MANUAL',
        reason:
          `Broker reports ${order.filledQuantity.units} ${order.ticker} filled against an order ` +
          `for ${planned.units}. Reconcile with the broker before anything is minted.`,
      };
    }

    // The program refuses to attest a fill worse than the trader's limit, so a
    // fill above it can never be minted. Catch it here where we can still say why.
    if (greaterThan(order.averagePrice, requireLimitPrice(ctx))) {
      return {
        kind: 'MANUAL',
        reason:
          `Average fill ${order.averagePrice.amount} exceeds the trader's limit ` +
          `${requireLimitPrice(ctx).amount}. The program will not mint this position.`,
      };
    }

    await ledger.post(
      buyFilled(
        ctx.intent.id,
        order.grossConsideration,
        order.totalCommission,
        order.totalLevies,
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
      },
    };
  },
};

/**
 * Finish the crossing that funded the order and release the buffer hold.
 *
 * On the just-in-time path this is already done and the step is a formality; on
 * the buffer path this is where the replenishment actually lands.
 */
const settleCrossing: Step<Services> = {
  name: 'settle_crossing',

  async run(ctx): Promise<StepResult> {
    const { msb, ledger, treasury, config } = ctx.services;
    const conversionRef = ctx.facts.conversionRef;
    if (!conversionRef) {
      throw new ValidationError('settle_crossing reached without a conversion', {
        intentId: ctx.intent.id,
      });
    }

    const conversion = await msb.getConversion(conversionRef);
    if (!conversion) {
      throw new RetryableError({
        code: 'conversion_missing',
        message: `Conversion ${conversionRef} could not be read back`,
      });
    }

    if (conversion.status === 'FAILED' || conversion.status === 'CANCELLED') {
      // The shares are already bought. Unwinding now would sell them at a loss
      // for a funding problem that is ours, not the trader's.
      return {
        kind: 'MANUAL',
        reason:
          `The USDC→HKD crossing failed after the order filled ` +
          `(${conversion.failureReason ?? conversion.status}). The position is held but ` +
          `unfunded; treasury must cover it before the mint can proceed.`,
      };
    }

    if (conversion.status !== 'SETTLED' || !conversion.to) {
      return {
        kind: 'WAIT',
        reason: 'Waiting for the USDC→HKD crossing to settle',
        facts: { conversionId: conversion.id },
      };
    }

    if (!ctx.facts.convertedAmount) {
      await ledger.post(
        conversionSettled(
          ctx.intent.id,
          conversion.from,
          conversion.to,
          conversion.fee ?? zero(conversion.from.currency),
          'MSB_SETTLED',
        ),
      );
    }

    const payoutRef = ctx.facts.payoutRef ?? `${ctx.clientRef}.payout`;
    let payout = await msb.getPayout(payoutRef);
    if (!payout) {
      payout = await msb.createPayout({
        clientRef: payoutRef,
        amount: conversion.to,
        destination: {
          rail: 'BANK',
          beneficiaryId: config.accounts.brokerRef,
          reference: ctx.intent.id,
        },
        purpose: 'SECURITIES_SETTLEMENT',
      });
    }

    if (payout.status === 'FAILED' || payout.status === 'RETURNED') {
      return {
        kind: 'MANUAL',
        reason: `Broker funding failed after the fill: ${payout.failureReason ?? payout.status}`,
      };
    }

    if (payout.status !== 'SETTLED') {
      // Persist the reference on the way past. Without it a resume would
      // re-derive it correctly but an operator reading the intent would have no
      // idea which payout to chase.
      return {
        kind: 'WAIT',
        reason: 'Waiting for the payout to reach the broker',
        facts: { payoutRef, payoutId: payout.id, convertedAmount: conversion.to },
      };
    }

    await ledger.post(brokerFunded(ctx.intent.id, payout.amount));

    if (ctx.facts.reservationId) {
      await treasury.consume(ctx.facts.reservationId);
    }

    return {
      kind: 'ADVANCE',
      facts: {
        convertedAmount: conversion.to,
        payoutRef,
        payoutId: payout.id,
        msbFee: conversion.fee ?? undefined,
      },
    };
  },

  async resolve(ctx): Promise<StepResult | null> {
    const conversion = await ctx.services.msb.getConversion(ctx.facts.conversionRef ?? '');
    if (!conversion) return null;
    return settleCrossing.run(ctx);
  },
};

/**
 * Wait for the custodian to settle the trade (HKEX equities settle T+2) and
 * fetch the document that will back the on-chain attestation.
 */
const awaitCustody: Step<Services> = {
  name: 'await_custody',

  async run(ctx): Promise<StepResult> {
    const { custodian, ledger } = ctx.services;
    const tradeReference = ctx.facts.brokerTradeReference;
    if (!tradeReference) {
      return {
        kind: 'MANUAL',
        reason: 'The broker fill carried no trade reference, so custody cannot be matched to it',
      };
    }

    const settlement = await custodian.getSettlementByTrade(tradeReference);
    if (!settlement) {
      return { kind: 'WAIT', reason: 'Custodian has not acknowledged the trade yet', retryAfterMillis: 60_000 };
    }

    if (settlement.status === 'FAILED') {
      return {
        kind: 'MANUAL',
        reason: `Settlement failed at the custodian: ${settlement.failureReason ?? 'unknown'}`,
      };
    }

    if (settlement.status !== 'SETTLED') {
      return { kind: 'WAIT', reason: `Settlement is ${settlement.status}`, retryAfterMillis: 60_000 };
    }

    if (!settlement.positionReference || !settlement.documentRef) {
      // The program rejects a zeroed custody reference or document hash, so a
      // settlement without both cannot be attested. Never fabricate them.
      return {
        kind: 'MANUAL',
        reason:
          'Custodian reported settlement without a position reference or document. ' +
          'The mint requires both and neither can be substituted.',
      };
    }

    const document = await custodian.getDocument(settlement.documentRef);
    if (!document) {
      throw new RetryableError({
        code: 'custody_document_unavailable',
        message: `Document ${settlement.documentRef} could not be fetched`,
      });
    }

    await ledger.post(custodySettled(ctx.intent.id, settlement.quantity));

    return {
      kind: 'ADVANCE',
      facts: {
        custodySettlementId: settlement.settlementId,
        custodyReference: settlement.positionReference,
        documentRef: settlement.documentRef,
        documentHash: documentHash(document.bytes),
      },
    };
  },
};

/**
 * `confirm_buy` — the only path that mints.
 *
 * Attested quantity comes from the custodian, not from the broker fill: token
 * supply must track custodied shares, which is what makes the backing claim
 * verifiable rather than asserted.
 */
const attestAndMint: Step<Services> = {
  name: 'attest_and_mint',

  async run(ctx): Promise<StepResult> {
    const { chain, ledger, store } = ctx.services;
    const ticker = requireTicker(ctx);
    const orderId = requireOrderId(ctx);

    // Interlock. A confirmed backing shortfall means custodied shares are
    // already fewer than tokens outstanding; minting now would deepen it.
    // Detection that leaves the mint path open is not a control.
    const shortfall = await openBackingBreak(store, ticker);
    if (shortfall) {
      return { kind: 'MANUAL', reason: mintBlockedReason(ticker, shortfall) };
    }

    const { custodyReference, documentHash: hash, filledQuantity, averagePrice, grossConsideration } =
      ctx.facts;

    if (!custodyReference || !hash || !filledQuantity || !averagePrice || !grossConsideration) {
      throw new ValidationError('attest_and_mint reached without a complete attestation', {
        intentId: ctx.intent.id,
      });
    }

    const result = await chain.confirmBuy({
      orderId,
      ticker,
      quantity: filledQuantity,
      averagePrice,
      custodyReference,
      documentHash: hash,
    });

    if (!result.alreadyApplied) {
      const escrowed = requireEscrowed(ctx);
      const spread = ctx.facts.spreadEarned ?? zero(escrowed.currency);
      await ledger.post(
        buyMinted(ctx.intent.id, subtract(escrowed, spread), grossConsideration, filledQuantity),
      );
    }

    return { kind: 'ADVANCE', facts: { confirmSignature: result.signature } };
  },

  async resolve(ctx): Promise<StepResult | null> {
    const { chain } = ctx.services;
    const order = await chain.getSpotOrder(requireTicker(ctx), requireOrderId(ctx));
    if (!order) return null;
    if (order.state !== 'FILLED') return null;

    const escrowed = requireEscrowed(ctx);
    const spread = ctx.facts.spreadEarned ?? zero(escrowed.currency);
    const { filledQuantity, grossConsideration } = ctx.facts;
    if (!filledQuantity || !grossConsideration) return null;

    if (!ctx.facts.confirmSignature) {
      await ctx.services.ledger.post(
        buyMinted(ctx.intent.id, subtract(escrowed, spread), grossConsideration, filledQuantity),
      );
    }
    return { kind: 'ADVANCE', facts: {} };
  },
};

export const spotBuySaga: Saga<Services> = {
  kind: 'SPOT_BUY',
  steps: [
    screen,
    validateOrder,
    reserveFunding,
    deployEscrow,
    fundExecution,
    placeOrder,
    awaitFill,
    settleCrossing,
    awaitCustody,
    attestAndMint,
  ],
};

/** Exported for focused unit tests. */
export const spotBuySteps = {
  screen,
  validateOrder,
  reserveFunding,
  deployEscrow,
  fundExecution,
  placeOrder,
  awaitFill,
  settleCrossing,
  awaitCustody,
  attestAndMint,
};

/* Re-exported so tests can build the same figures the saga does. */
export { tradableQuantity, fundingRequirement };
