/**
 * Per-holder vault sagas.
 *
 * Depositing into a vault is permissionless on-chain, so these sagas do not
 * *authorise* anything — the deposit has already happened by the time we see
 * it. What they do is screen the depositor, book the liability, and give
 * compliance a lever: a subscriber who fails screening is escalated and the
 * vault can be frozen with `freeze_deposits` while it is resolved.
 *
 * The deal itself is orchestrated by the vault mandate driver, not here.
 */

import { ValidationError } from '../../domain/errors.js';
import { basisPoints, type Money, type Quantity } from '../../domain/money.js';
import {
  vaultClaimed,
  vaultDelivered,
  vaultDeliveryElected,
  vaultDeposit,
} from '../../ledger/postings.js';
import { tierSatisfies } from '../../ports/compliance.js';
import type { Services } from '../../services.js';
import type { Saga, Step, StepContext, StepResult } from '../runner.js';

type Ctx = StepContext<Services>;

function requireVaultId(ctx: Ctx): string {
  const vaultId = ctx.intent.request.vaultId;
  if (!vaultId) throw new ValidationError('Vault intent has no vault id', { intentId: ctx.intent.id });
  return vaultId;
}

function requireAmount(ctx: Ctx): Money {
  const amount = ctx.intent.request.amount;
  if (!amount) throw new ValidationError('Vault intent has no amount', { intentId: ctx.intent.id });
  return amount;
}

function requireQuantity(ctx: Ctx): Quantity {
  const qty = ctx.intent.request.quantity;
  if (!qty) throw new ValidationError('Vault intent has no share quantity', { intentId: ctx.intent.id });
  return qty;
}

/* -------------------------------------------------------------------------- */
/* VAULT_SUBSCRIBE                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Screen a depositor after the fact.
 *
 * A BLOCK here cannot un-deposit the money — the program has already minted the
 * claim token — so it parks for a human and recommends freezing the vault
 * rather than pretending it can unwind. That honesty matters: silently
 * "cancelling" would leave a screened-out subscriber holding a live claim.
 */
const screenSubscriber: Step<Services> = {
  name: 'screen_subscriber',

  async run(ctx): Promise<StepResult> {
    const { compliance } = ctx.services;
    const amount = requireAmount(ctx);

    const request = {
      wallet: ctx.intent.wallet,
      action: 'VAULT_SUBSCRIBE' as const,
      amount,
    };

    const [verification, requiredTier, screening, limits] = await Promise.all([
      compliance.getVerification(ctx.intent.wallet),
      compliance.requiredTier('VAULT_SUBSCRIBE', amount),
      compliance.screen(request),
      compliance.assessLimits(request),
    ]);

    if (screening.decision === 'BLOCK') {
      return {
        kind: 'MANUAL',
        reason:
          `Screening blocked subscriber ${ctx.intent.wallet} after the deposit landed ` +
          `(${screening.reasons.join('; ')}). The claim token is already minted — consider ` +
          `freeze_deposits on vault ${requireVaultId(ctx)} while this is resolved.`,
        facts: { screeningId: screening.screeningId, screeningDecision: 'BLOCK' },
      };
    }

    if (!verification || verification.status !== 'VERIFIED') {
      return {
        kind: 'MANUAL',
        reason: `Subscriber ${ctx.intent.wallet} deposited without a current verification`,
        facts: { screeningId: screening.screeningId },
      };
    }

    if (!tierSatisfies(verification.tier, requiredTier)) {
      return {
        kind: 'MANUAL',
        reason:
          `Subscription requires ${requiredTier}; subscriber holds ${verification.tier}. ` +
          `Pre-IPO offerings may be restricted to professional investors.`,
        facts: { screeningId: screening.screeningId },
      };
    }

    if (screening.decision === 'REVIEW' || !limits.withinLimits) {
      return {
        kind: 'MANUAL',
        reason: `Subscription flagged: ${[...screening.reasons, ...limits.reasons].join('; ')}`,
        facts: { screeningId: screening.screeningId, screeningDecision: 'REVIEW' },
      };
    }

    return {
      kind: 'ADVANCE',
      facts: { screeningId: screening.screeningId, screeningDecision: 'CLEAR' },
    };
  },
};

/**
 * Book the subscription.
 *
 * The upfront fee is deducted on-chain but stays a liability here: it is
 * refundable until `deploy_capital`, so recognising it as income now would
 * overstate revenue on any deal that later cancels.
 */
const bookSubscription: Step<Services> = {
  name: 'book_subscription',

  async run(ctx): Promise<StepResult> {
    const { ledger, chain } = ctx.services;
    const gross = requireAmount(ctx);
    const vault = await chain.getVault(requireVaultId(ctx));

    await ledger.post(vaultDeposit(ctx.intent.id, gross));

    const feeBps = vault?.feeBps ?? 500;
    return {
      kind: 'ADVANCE',
      facts: {
        vaultPhase: vault?.phase,
        spreadEarned: basisPoints(gross, feeBps, 'DOWN'),
      },
    };
  },
};

export const vaultSubscribeSaga: Saga<Services> = {
  kind: 'VAULT_SUBSCRIBE',
  steps: [screenSubscriber, bookSubscription],
};

/* -------------------------------------------------------------------------- */
/* VAULT_REDEEM                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A holder burned claim tokens for USDC.
 *
 * Redemption is permissionless once the vault is Claimable, so this is purely a
 * bookkeeping observer. There is no screening gate: refusing to record a
 * redemption that already happened would only break the books.
 */
const bookRedemption: Step<Services> = {
  name: 'book_redemption',

  async run(ctx): Promise<StepResult> {
    const { ledger, chain } = ctx.services;
    const paid = requireAmount(ctx);
    const vault = await chain.getVault(requireVaultId(ctx));

    await ledger.post(vaultClaimed(ctx.intent.id, paid));

    return { kind: 'ADVANCE', facts: { vaultPhase: vault?.phase, netProceeds: paid } };
  },
};

export const vaultRedeemSaga: Saga<Services> = {
  kind: 'VAULT_REDEEM',
  steps: [bookRedemption],
};

/* -------------------------------------------------------------------------- */
/* VAULT_DELIVERY                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A holder elected to take the real shares instead of cash.
 *
 * `elect_delivery` has already burned the claim token on-chain. This saga moves
 * the real shares out through the custodian to the holder's own brokerage
 * account and reconciles against `buyer_state.underlying_delivered`.
 */
const recordElection: Step<Services> = {
  name: 'record_election',

  async run(ctx): Promise<StepResult> {
    const { ledger } = ctx.services;
    await ledger.post(vaultDeliveryElected(ctx.intent.id, requireQuantity(ctx)));
    return { kind: 'ADVANCE' };
  },
};

/**
 * Instruct the custodian to deliver.
 *
 * The beneficiary reference is registered out of band and stored on the
 * account; raw brokerage account details never transit this service.
 */
const requestDelivery: Step<Services> = {
  name: 'request_delivery',

  async run(ctx): Promise<StepResult> {
    const { custodian, store } = ctx.services;
    const qty = requireQuantity(ctx);

    const account = await store.accounts.get(ctx.intent.wallet);
    const beneficiaryRef =
      ctx.intent.request.beneficiaryRef ?? account?.beneficiaryRefs[qty.ticker] ?? account?.beneficiaryRefs['default'];

    if (!beneficiaryRef) {
      return {
        kind: 'MANUAL',
        reason:
          `Holder ${ctx.intent.wallet} elected delivery but has no registered receiving ` +
          `account. Shares cannot be delivered until one is provided out of band.`,
      };
    }

    const existing = await custodian.getDelivery(ctx.clientRef);
    const instruction =
      existing ??
      (await custodian.requestDelivery({
        clientRef: ctx.clientRef,
        ticker: qty.ticker,
        quantity: qty,
        beneficiaryRef,
      }));

    if (instruction.status === 'REJECTED') {
      return {
        kind: 'MANUAL',
        reason: `Custodian rejected the delivery: ${instruction.rejectReason ?? 'unknown'}`,
        facts: { deliveryRef: ctx.clientRef },
      };
    }

    return { kind: 'ADVANCE', facts: { deliveryRef: ctx.clientRef } };
  },

  async resolve(ctx): Promise<StepResult | null> {
    const existing = await ctx.services.custodian.getDelivery(ctx.clientRef);
    if (!existing) return null;
    return { kind: 'ADVANCE', facts: { deliveryRef: ctx.clientRef } };
  },
};

const awaitDelivery: Step<Services> = {
  name: 'await_delivery',

  async run(ctx): Promise<StepResult> {
    const { custodian, ledger } = ctx.services;
    const deliveryRef = ctx.facts.deliveryRef;
    if (!deliveryRef) {
      throw new ValidationError('await_delivery reached without a delivery instruction', {
        intentId: ctx.intent.id,
      });
    }

    const instruction = await custodian.getDelivery(deliveryRef);
    if (!instruction) {
      return { kind: 'WAIT', reason: 'Custodian has not acknowledged the delivery yet', retryAfterMillis: 60_000 };
    }
    if (instruction.status === 'REJECTED') {
      return {
        kind: 'MANUAL',
        reason: `Custodian rejected the delivery: ${instruction.rejectReason ?? 'unknown'}`,
      };
    }
    if (instruction.status !== 'DELIVERED') {
      return { kind: 'WAIT', reason: `Delivery is ${instruction.status}`, retryAfterMillis: 60_000 };
    }

    await ledger.post(vaultDelivered(ctx.intent.id, instruction.quantity));
    return { kind: 'ADVANCE' };
  },
};

export const vaultDeliverySaga: Saga<Services> = {
  kind: 'VAULT_DELIVERY',
  steps: [recordElection, requestDelivery, awaitDelivery],
};

export const vaultIntentSteps = {
  screenSubscriber,
  bookSubscription,
  bookRedemption,
  recordElection,
  requestDelivery,
  awaitDelivery,
};
