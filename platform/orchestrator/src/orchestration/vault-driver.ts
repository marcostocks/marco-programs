/**
 * Vault mandate driver.
 *
 * Advances one on-chain vault through its thirteen phases, each transition
 * gated on a real off-chain fact. The rule the driver exists to enforce:
 *
 *     the on-chain phase never runs ahead of the event that justifies it.
 *
 * `mark_listed` is not submitted because a listing date passed — it is
 * submitted because the custodian confirmed the shares. `settle` is not
 * submitted because a sale happened — it is submitted because the USDC is
 * actually back. Every handler below reads the fact before it writes the phase.
 *
 * This is deliberately a separate driver from the intent saga runner. A vault
 * is a deal, not a user request: it advances on operator authority and outlives
 * any individual subscription.
 */

import type { Clock } from '../domain/clock.js';
import { describeError, ValidationError } from '../domain/errors.js';
import { newId, type IdSource, systemIdSource } from '../domain/ids.js';
import { subtract, zero, type Money } from '../domain/money.js';
import {
  brokerFunded,
  conversionSettled,
  sentToMsb,
  vaultAllocated,
  vaultDeployed,
  vaultSettled,
} from '../ledger/postings.js';
import type { VaultPhase } from '../ports/chain.js';
import type { Services } from '../services.js';
import {
  assertPhaseAdvance,
  type MandateState,
  type NewVaultMandate,
  type VaultMandate,
  type VaultMandateFacts,
} from './vault-mandate.js';

export interface MandateTickResult {
  readonly mandateId: string;
  readonly phase: VaultPhase;
  readonly advancedTo: VaultPhase | null;
  readonly waiting: string | null;
  readonly parked: string | null;
}

export class VaultDriver {
  private readonly clock: Clock;
  private readonly idSource: IdSource;

  constructor(
    private readonly services: Services,
    idSource: IdSource = systemIdSource,
  ) {
    this.clock = services.clock;
    this.idSource = idSource;
  }

  async createMandate(input: NewVaultMandate): Promise<VaultMandate> {
    const existing = await this.services.store.mandates.findByVaultId(input.vaultId);
    if (existing) return existing;

    const onChain = await this.services.chain.getVault(input.vaultId);
    if (!onChain) {
      throw new ValidationError(`No on-chain vault ${input.vaultId}`, { vaultId: input.vaultId });
    }

    const now = this.clock.nowIso();
    return this.services.store.mandates.create({
      id: newId('vlt', this.idSource),
      vaultId: input.vaultId,
      listingId: input.listingId,
      companyName: input.companyName,
      state: 'ACTIVE',
      phase: onChain.phase,
      requestedPhase: null,
      facts: input.facts ?? {},
      electionPeriodSeconds: input.electionPeriodSeconds,
      brokerAccountRef: input.brokerAccountRef,
      custodyAccountRef: input.custodyAccountRef,
      attempts: {},
      nextAttemptAt: now,
      manualReason: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }

  /** Authorise the next phase advance. Nothing moves without this. */
  async requestPhase(mandateId: string, phase: VaultPhase): Promise<VaultMandate> {
    const mandate = await this.require(mandateId);
    assertPhaseAdvance(mandate.phase, phase);
    return this.services.store.mandates.save(
      { ...mandate, requestedPhase: phase, nextAttemptAt: this.clock.nowIso(), state: 'ACTIVE' },
      mandate.version,
    );
  }

  async tickAll(limit = 10): Promise<MandateTickResult[]> {
    const due = await this.services.store.mandates.claimDue(this.clock.nowIso(), limit, 60_000);
    const results: MandateTickResult[] = [];
    for (const mandate of due) {
      try {
        results.push(await this.tick(mandate.id));
      } catch (error) {
        this.services.logger.error(
          { mandateId: mandate.id, error: describeError(error) },
          'Vault driver failed',
        );
      }
    }
    return results;
  }

  /**
   * Sync with the chain, then attempt the authorised advance.
   *
   * On-chain phase is always authoritative. If someone advanced the vault
   * through a multisig transaction outside this service, the mandate follows
   * rather than fighting it.
   */
  async tick(mandateId: string): Promise<MandateTickResult> {
    let mandate = await this.require(mandateId);
    const onChain = await this.services.chain.getVault(mandate.vaultId);
    if (!onChain) {
      return this.park(mandate, `On-chain vault ${mandate.vaultId} could not be read`);
    }

    if (onChain.phase !== mandate.phase) {
      this.services.logger.info(
        { mandateId, from: mandate.phase, to: onChain.phase },
        'Vault phase changed on-chain; syncing the mandate',
      );
      // The authorisation is deliberately *not* cleared here. Several phases
      // submit their on-chain transition first and then complete the money
      // movement that belongs to it — `deploy_capital` releases the USDC, and
      // only then does the crossing and the wire happen. Clearing the request
      // the moment the chain moved would abandon that follow-through half done.
      mandate = await this.services.store.mandates.save(
        { ...mandate, phase: onChain.phase },
        mandate.version,
      );
    }

    const target = mandate.requestedPhase;
    if (!target) {
      return this.idle(mandate, 'No phase advance is authorised');
    }

    // Once the phase itself is reached the handler still runs, idempotently, to
    // finish whatever off-chain work the phase owns. It is `advance()` that
    // clears the authorisation, and it only runs when the handler says so.
    if (mandate.phase !== target) {
      try {
        assertPhaseAdvance(mandate.phase, target);
      } catch (error) {
        return this.park(mandate, describeError(error).message as string);
      }
    }

    switch (target) {
      case 'Funding':
        return this.toFunding(mandate);
      case 'Sealed':
        return this.toSealed(mandate);
      case 'Sourcing':
        return this.toSourcing(mandate);
      case 'Sourced':
        return this.toSourced(mandate);
      case 'Deployed':
        return this.toDeployed(mandate);
      case 'Live':
        return this.toLive(mandate);
      case 'Realized':
        return this.toRealized(mandate);
      case 'Claimable':
        return this.toClaimable(mandate);
      case 'Winding':
        return this.simple(mandate, 'Winding', () =>
          this.services.chain.windDown(mandate.vaultId),
        );
      case 'Concluded':
        return this.simple(mandate, 'Concluded', () =>
          this.services.chain.concludeVault(mandate.vaultId),
        );
      case 'Cancelled':
        return this.toCancelled(mandate);
      default:
        return this.park(mandate, `No handler for phase ${target}`);
    }
  }

  /* ---- Phase handlers -------------------------------------------------- */

  private async toFunding(mandate: VaultMandate): Promise<MandateTickResult> {
    const listing = await this.services.broker.getIpoListing(mandate.listingId);
    if (!listing) {
      return this.wait(mandate, `Broker does not yet know listing ${mandate.listingId}`);
    }
    if (this.clock.nowIso() > listing.applicationClosesAt) {
      return this.park(
        mandate,
        `The application window for ${mandate.listingId} closed at ${listing.applicationClosesAt}; ` +
          `opening funding now would take deposits we cannot apply.`,
      );
    }
    return this.simple(mandate, 'Funding', () => this.services.chain.openFunding(mandate.vaultId));
  }

  /**
   * Sealing is time-critical: the broker's application deadline is a hard wall,
   * and the vault must be sealed with enough margin to source and deploy.
   */
  private async toSealed(mandate: VaultMandate): Promise<MandateTickResult> {
    return this.simple(mandate, 'Sealed', () => this.services.chain.sealFunding(mandate.vaultId));
  }

  private async toSourcing(mandate: VaultMandate): Promise<MandateTickResult> {
    return this.simple(mandate, 'Sourcing', () =>
      this.services.chain.beginSourcing(mandate.vaultId),
    );
  }

  /**
   * Submit the IPO application and record the deployable amount the broker will
   * actually accept. `confirm_allocation` fixes what `deploy_capital` may send,
   * so it must reflect the broker's acceptance, not our hope.
   */
  private async toSourced(mandate: VaultMandate): Promise<MandateTickResult> {
    const { broker, chain, logger } = this.services;

    const vault = await chain.getVault(mandate.vaultId);
    if (!vault) return this.park(mandate, 'Vault disappeared on-chain');

    const listing = await broker.getIpoListing(mandate.listingId);
    if (!listing) return this.wait(mandate, `Broker does not know listing ${mandate.listingId}`);

    const clientRef = `${mandate.id}.ipo_application`;
    let subscription = await broker.getIpoSubscription(clientRef);

    if (!subscription) {
      // Apply for what the vault actually raised, net of the escrowed fee.
      const applied = subtract(vault.totalDeposits, vault.feesEscrowed);
      const price = listing.finalOfferPrice ?? listing.offerPriceRange.high;
      const units = price.amount > 0n ? applied.amount / price.amount : 0n;
      const appliedQuantity = { ticker: listing.ticker ?? mandate.listingId, units };

      if (units === 0n) {
        return this.park(mandate, 'Vault raised less than one share at the offer price');
      }

      subscription = await broker.placeIpoSubscription({
        clientRef,
        listingId: mandate.listingId,
        appliedAmount: applied,
        appliedQuantity,
        accountRef: mandate.brokerAccountRef,
      });
      logger.info({ mandateId: mandate.id, clientRef }, 'Submitted the IPO application');
    }

    if (subscription.status === 'REJECTED') {
      return this.park(
        mandate,
        `Broker rejected the IPO application: ${subscription.rejectReason ?? 'unknown'}`,
      );
    }
    if (subscription.status === 'UNSUCCESSFUL') {
      return this.park(
        mandate,
        'The IPO ballot returned no allocation. Cancel the vault and refund subscribers.',
      );
    }
    if (subscription.status === 'SUBMITTED') {
      return this.wait(mandate, 'Waiting for the broker to accept the application');
    }

    const deployable = subscription.appliedAmount;
    const result = await chain.confirmAllocation(mandate.vaultId, deployable);

    return this.advance(mandate, 'Sourced', {
      ipoSubscriptionRef: clientRef,
      ipoBrokerRef: subscription.brokerRef ?? undefined,
      appliedAmount: subscription.appliedAmount,
      appliedQuantity: subscription.appliedQuantity,
      allocatedQuantity: subscription.allocatedQuantity ?? undefined,
    }, result.signature);
  }

  /**
   * `deploy_capital` then the money movement: USDC to the MSB, crossed to HKD,
   * wired to the broker. The upfront fee is *earned* at this point — the
   * program moves it from `fees_escrowed` to `fees_collected` — so it is
   * recognised as income here and not before.
   */
  private async toDeployed(mandate: VaultMandate): Promise<MandateTickResult> {
    const { chain, msb, ledger, logger } = this.services;

    const vault = await chain.getVault(mandate.vaultId);
    if (!vault) return this.park(mandate, 'Vault disappeared on-chain');
    if (!vault.deployableAmount) {
      return this.wait(mandate, 'Allocation has not been confirmed on-chain');
    }

    let facts: VaultMandateFacts = { ...mandate.facts };

    if (vault.deployedAmount.amount === 0n) {
      const result = await chain.deployCapital(mandate.vaultId, vault.deployableAmount);
      if (!result.alreadyApplied) {
        await ledger.post(
          vaultDeployed(mandate.id, vault.deployableAmount, vault.feesEscrowed),
        );
      }
      logger.info({ mandateId: mandate.id }, 'Deployed vault capital to the broker destination');
    }

    const conversionRef = `${mandate.id}.deploy_conversion`;
    let conversion = await msb.getConversion(conversionRef);
    if (!conversion) {
      conversion = await msb.createConversion({
        clientRef: conversionRef,
        from: vault.deployableAmount,
        to: 'HKD',
        purpose: 'IPO_SUBSCRIPTION',
      });
    }
    if (conversion.status === 'FAILED' || conversion.status === 'CANCELLED') {
      return this.park(
        mandate,
        `The USDC→HKD crossing for the IPO application failed: ${conversion.failureReason ?? conversion.status}`,
      );
    }
    if (conversion.status !== 'SETTLED' || !conversion.to) {
      return this.wait(mandate, 'Waiting for the USDC→HKD crossing to settle');
    }

    if (!facts.convertedAmount) {
      await ledger.post(
        conversionSettled(
          mandate.id,
          conversion.from,
          conversion.to,
          conversion.fee ?? zero(conversion.from.currency),
          'MSB_SETTLED',
        ),
      );
      facts = { ...facts, conversionRef, convertedAmount: conversion.to };
    }

    const payoutRef = `${mandate.id}.deploy_payout`;
    let payout = await msb.getPayout(payoutRef);
    if (!payout) {
      payout = await msb.createPayout({
        clientRef: payoutRef,
        amount: conversion.to,
        destination: {
          rail: 'BANK',
          beneficiaryId: mandate.brokerAccountRef,
          reference: mandate.vaultId,
        },
        purpose: 'IPO_SUBSCRIPTION',
      });
    }
    if (payout.status === 'FAILED' || payout.status === 'RETURNED') {
      return this.park(mandate, `Funding the IPO application failed: ${payout.failureReason ?? payout.status}`);
    }
    if (payout.status !== 'SETTLED') {
      return this.wait(mandate, 'Waiting for the application funds to reach the broker');
    }

    await ledger.post(brokerFunded(mandate.id, payout.amount));

    return this.advance(mandate, 'Deployed', { ...facts, payoutRef }, null);
  }

  /**
   * `mark_listed` — gated on the **custodian** confirming the shares, not on
   * the listing date. Recording an allocation we do not hold would put a number
   * on-chain that reconciliation could never satisfy.
   */
  private async toLive(mandate: VaultMandate): Promise<MandateTickResult> {
    const { broker, custodian, chain, ledger } = this.services;

    const clientRef = mandate.facts.ipoSubscriptionRef ?? `${mandate.id}.ipo_application`;
    const subscription = await broker.getIpoSubscription(clientRef);
    if (!subscription) return this.wait(mandate, 'Broker has no record of the application');

    if (subscription.status === 'UNSUCCESSFUL') {
      return this.park(mandate, 'The ballot returned no allocation after deployment. Escalate.');
    }
    if (subscription.status !== 'ALLOCATED' || !subscription.allocatedQuantity) {
      return this.wait(mandate, 'Waiting for the ballot result');
    }

    const listing = await broker.getIpoListing(mandate.listingId);
    const ticker = listing?.ticker ?? subscription.allocatedQuantity.ticker;

    const position = await custodian.getPosition(mandate.custodyAccountRef, ticker);
    if (!position || position.settled.units < subscription.allocatedQuantity.units) {
      return this.wait(
        mandate,
        `Custodian holds ${position?.settled.units ?? 0n} of ${subscription.allocatedQuantity.units} ${ticker}`,
      );
    }

    if (!mandate.facts.allocatedQuantity) {
      await ledger.post(
        vaultAllocated(
          mandate.id,
          subscription.allocatedQuantity,
          subscription.allocatedAmount ?? zero('HKD'),
          subscription.refundAmount ?? zero('HKD'),
        ),
      );
    }

    const result = await chain.markListed(
      mandate.vaultId,
      subscription.allocatedQuantity,
      mandate.electionPeriodSeconds,
    );

    return this.advance(
      mandate,
      'Live',
      {
        allocatedQuantity: subscription.allocatedQuantity,
        allocatedAmount: subscription.allocatedAmount ?? undefined,
        registrarRefund: subscription.refundAmount ?? undefined,
        listedTicker: ticker,
        finalOfferPrice: listing?.finalOfferPrice ?? undefined,
      },
      result.signature,
    );
  }

  /**
   * Sell the position and report gross proceeds.
   *
   * The program blocks `mark_realized` until the election window closes, so
   * nobody can elect delivery of a position that has already been sold. We
   * check the same deadline here to fail readably instead of as a constraint
   * violation.
   */
  private async toRealized(mandate: VaultMandate): Promise<MandateTickResult> {
    const { broker, chain } = this.services;

    const vault = await chain.getVault(mandate.vaultId);
    if (!vault) return this.park(mandate, 'Vault disappeared on-chain');

    if (vault.electionDeadline && this.clock.nowIso() < vault.electionDeadline) {
      return this.wait(mandate, `Delivery-election window closes at ${vault.electionDeadline}`);
    }

    const ticker = mandate.facts.listedTicker;
    const allocated = mandate.facts.allocatedQuantity;
    if (!ticker || !allocated) return this.park(mandate, 'Listing facts are missing');

    // Electors take their shares in kind, so only the cash cohort is sold.
    const toSell = { ticker, units: allocated.units - vault.deliveredShares };
    if (toSell.units <= 0n) {
      return this.advance(mandate, 'Realized', { soldQuantity: { ticker, units: 0n } }, null);
    }

    const clientOrderId = `${mandate.id}.sale`;
    let order = await broker.getOrder(clientOrderId);
    if (!order) {
      const instrument = await broker.getInstrument(ticker);
      if (!instrument) return this.wait(mandate, `Broker does not yet list ${ticker}`);
      order = await broker.placeOrder({
        clientOrderId,
        ticker,
        side: 'SELL',
        quantity: toSell,
        // A vault sale is a market exit; the floor protects against a
        // dislocation, it is not a target price.
        limitPrice: {
          currency: 'HKD',
          amount: (instrument.tickSize.amount > 0n ? instrument.tickSize.amount : 1n),
        },
        timeInForce: 'DAY',
        accountRef: mandate.brokerAccountRef,
      });
    }

    if (order.status === 'REJECTED') {
      return this.park(mandate, `Broker rejected the vault sale: ${order.rejectReason}`);
    }
    if (order.status !== 'FILLED' || !order.grossConsideration) {
      return this.wait(mandate, `Vault sale is ${order.status}`);
    }

    const result = await chain.markRealized(mandate.vaultId, order.grossConsideration);

    return this.advance(
      mandate,
      'Realized',
      {
        saleClientOrderId: clientOrderId,
        soldQuantity: order.filledQuantity,
        saleAveragePrice: order.averagePrice ?? undefined,
        grossProceedsHkd: order.grossConsideration,
      },
      result.signature,
    );
  }

  /**
   * `settle` — gated on the USDC actually being back. This is the transition
   * that opens redemption, and opening it against money still in transit is how
   * a vault ends up unable to pay its holders.
   */
  private async toClaimable(mandate: VaultMandate): Promise<MandateTickResult> {
    const { msb, chain, ledger } = this.services;

    const gross = mandate.facts.grossProceedsHkd;
    if (!gross) return this.park(mandate, 'No realised proceeds recorded');

    const conversionRef = `${mandate.id}.repatriation`;
    let conversion = await msb.getConversion(conversionRef);
    if (!conversion) {
      await ledger.post(sentToMsb(mandate.id, gross, 'BROKER_PROCEEDS'));
      conversion = await msb.createConversion({
        clientRef: conversionRef,
        from: gross,
        to: 'USDC',
        purpose: 'TREASURY_REPATRIATION',
      });
    }

    if (conversion.status === 'FAILED' || conversion.status === 'CANCELLED') {
      return this.park(
        mandate,
        `Repatriating the vault proceeds failed: ${conversion.failureReason ?? conversion.status}`,
      );
    }
    if (conversion.status !== 'SETTLED' || !conversion.to) {
      return this.wait(mandate, 'Waiting for the HKD→USDC repatriation to settle');
    }

    const vault = await chain.getVault(mandate.vaultId);
    const subscriptionOutstanding: Money = vault
      ? subtract(vault.totalDeposits, vault.feesCollected)
      : conversion.to;

    const result = await chain.settleVault(mandate.vaultId, conversion.to);

    // Guarded together: a re-entry after the chain transition already landed
    // must not book the repatriation or the settlement a second time.
    if (!mandate.facts.netProceedsUsdc) {
      await ledger.post(
        conversionSettled(
          mandate.id,
          conversion.from,
          conversion.to,
          conversion.fee ?? zero(conversion.from.currency),
          'TREASURY_USDC',
        ),
      );
      await ledger.post(vaultSettled(mandate.id, conversion.to, subscriptionOutstanding));
    }

    return this.advance(
      mandate,
      'Claimable',
      { repatriationRef: conversionRef, netProceedsUsdc: conversion.to },
      result.signature,
    );
  }

  /**
   * Abort a deal before capital has left. Past `Deployed` there is no path
   * back — the program does not offer one, and neither does this driver.
   */
  private async toCancelled(mandate: VaultMandate): Promise<MandateTickResult> {
    const costs = mandate.facts.unrefundableCosts ?? zero('USDC');
    const result = await this.services.chain.cancelVault(mandate.vaultId, costs);
    return this.advance(mandate, 'Cancelled', { unrefundableCosts: costs }, result.signature);
  }

  /* ---- Transition plumbing --------------------------------------------- */

  private async simple(
    mandate: VaultMandate,
    to: VaultPhase,
    submit: () => Promise<{ signature: string }>,
  ): Promise<MandateTickResult> {
    const result = await submit();
    return this.advance(mandate, to, {}, result.signature);
  }

  private async advance(
    mandate: VaultMandate,
    to: VaultPhase,
    facts: VaultMandateFacts,
    signature: string | null,
  ): Promise<MandateTickResult> {
    const saved = await this.services.store.mandates.save(
      {
        ...mandate,
        phase: to,
        requestedPhase: null,
        facts: { ...mandate.facts, ...facts },
        nextAttemptAt: this.clock.nowIso(),
        attempts: {},
      },
      mandate.version,
    );
    this.services.logger.info(
      { mandateId: mandate.id, from: mandate.phase, to, signature },
      'Vault phase advanced',
    );
    return { mandateId: saved.id, phase: to, advancedTo: to, waiting: null, parked: null };
  }

  private async wait(mandate: VaultMandate, reason: string): Promise<MandateTickResult> {
    await this.services.store.mandates.save(
      {
        ...mandate,
        nextAttemptAt: new Date(this.clock.nowMillis() + 60_000).toISOString(),
      },
      mandate.version,
    );
    this.services.logger.debug({ mandateId: mandate.id, reason }, 'Vault mandate waiting');
    return { mandateId: mandate.id, phase: mandate.phase, advancedTo: null, waiting: reason, parked: null };
  }

  private async idle(mandate: VaultMandate, reason: string): Promise<MandateTickResult> {
    await this.services.store.mandates.save(
      { ...mandate, nextAttemptAt: new Date(this.clock.nowMillis() + 300_000).toISOString() },
      mandate.version,
    );
    return { mandateId: mandate.id, phase: mandate.phase, advancedTo: null, waiting: reason, parked: null };
  }

  private async park(mandate: VaultMandate, reason: string): Promise<MandateTickResult> {
    const state: MandateState = 'NEEDS_MANUAL';
    await this.services.store.mandates.save(
      { ...mandate, state, manualReason: reason, nextAttemptAt: null },
      mandate.version,
    );
    this.services.logger.warn({ mandateId: mandate.id, reason }, 'Vault mandate parked');
    return { mandateId: mandate.id, phase: mandate.phase, advancedTo: null, waiting: null, parked: reason };
  }

  private async require(mandateId: string): Promise<VaultMandate> {
    const mandate = await this.services.store.mandates.get(mandateId);
    if (!mandate) throw new ValidationError(`Vault mandate ${mandateId} not found`, { mandateId });
    return mandate;
  }
}
