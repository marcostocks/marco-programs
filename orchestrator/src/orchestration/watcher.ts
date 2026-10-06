/**
 * Chain watcher — the only place intents are born.
 *
 * Intents are created from observed on-chain events, never from a bare HTTP
 * call, because the on-chain escrow *is* the authorisation. A trader whose USDC
 * is not locked in the market escrow has not agreed to anything, and an
 * orchestrator that accepts "please buy me 500 Tencent" over HTTP has no
 * cryptographic basis for spending their money.
 *
 * Two properties make this safe to restart:
 *
 *  - the cursor is persisted, so a crash re-reads from the last processed
 *    signature rather than from the head (a missed `place_buy` is a trader
 *    whose USDC sits escrowed forever);
 *  - creation is deduped on the transaction signature, so replaying the same
 *    window twice cannot produce two intents for one order.
 */

import { describeError } from '../domain/errors.js';
import { newId, type IdSource, systemIdSource } from '../domain/ids.js';
import { buyEscrowed } from '../ledger/postings.js';
import type { ChainCursor, ChainEvent } from '../ports/chain.js';
import type { Services } from '../services.js';
import type { Intent, IntentKind, IntentRequest } from './intent.js';

const CURSOR_NAME = 'chain:primary';

export interface WatcherResult {
  readonly polled: number;
  readonly created: number;
  readonly skipped: number;
  readonly cursor: ChainCursor;
}

export class ChainWatcher {
  constructor(
    private readonly services: Services,
    private readonly idSource: IdSource = systemIdSource,
  ) {}

  async poll(limit = 100): Promise<WatcherResult> {
    const { store, chain, logger } = this.services;

    const cursor = (await store.cursors.get(CURSOR_NAME)) ?? { lastSignature: null, lastSlot: 0 };
    const page = await chain.pollEvents(cursor, limit);

    let created = 0;
    let skipped = 0;

    for (const event of page.events) {
      try {
        const intent = await this.ingest(event);
        if (intent) created += 1;
        else skipped += 1;
      } catch (error) {
        // Advancing the cursor past an event we failed to ingest would lose it
        // permanently, so stop here and let the next poll retry from the same
        // point.
        logger.error(
          { signature: event.signature, kind: event.kind, error: describeError(error) },
          'Failed to ingest a chain event; holding the cursor',
        );
        return { polled: page.events.length, created, skipped, cursor };
      }
    }

    await store.cursors.set(CURSOR_NAME, page.cursor);
    return { polled: page.events.length, created, skipped, cursor: page.cursor };
  }

  /** Create the intent for one event, or return null if it is already known. */
  async ingest(event: ChainEvent): Promise<Intent | null> {
    const { store, ledger, logger } = this.services;

    const existing = await store.intents.findBySourceSignature(event.signature);
    if (existing) return null;

    const mapped = this.map(event);
    if (!mapped) return null;

    const now = this.services.clock.nowIso();
    const intent = await store.intents.create({
      id: newId('int', this.idSource),
      kind: mapped.kind,
      state: 'PENDING',
      stage: '',
      wallet: event.wallet,
      source: { signature: event.signature, slot: event.slot, observedAt: now },
      request: mapped.request,
      facts: {},
      attempts: {},
      lastError: null,
      nextAttemptAt: now,
      manualReason: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    // Book the escrow the moment we see it. Waiting until the saga runs would
    // leave a window where the trader's money is on-chain but absent from our
    // books, and that window is exactly when a reconciliation would run.
    if (mapped.kind === 'SPOT_BUY' && event.amount) {
      await ledger.post(buyEscrowed(intent.id, event.amount));
    }

    logger.info(
      { intentId: intent.id, kind: intent.kind, signature: event.signature },
      'Created intent from a chain event',
    );
    return intent;
  }

  private map(
    event: ChainEvent,
  ): { kind: IntentKind; request: IntentRequest } | null {
    switch (event.kind) {
      case 'spot.buy_placed':
        return {
          kind: 'SPOT_BUY',
          request: {
            ticker: event.ticker,
            orderId: event.orderId,
            amount: event.amount,
            quantity: event.shares,
            limitPrice: event.limitPrice,
          },
        };

      case 'spot.sell_placed':
        return {
          kind: 'SPOT_SELL',
          request: {
            ticker: event.ticker,
            orderId: event.orderId,
            quantity: event.shares,
            limitPrice: event.limitPrice,
          },
        };

      case 'vault.deposit':
        return {
          kind: 'VAULT_SUBSCRIBE',
          request: { vaultId: event.vaultId, amount: event.amount },
        };

      case 'vault.claim':
        return {
          kind: 'VAULT_REDEEM',
          request: { vaultId: event.vaultId, amount: event.amount },
        };

      case 'vault.delivery_elected':
        return {
          kind: 'VAULT_DELIVERY',
          request: { vaultId: event.vaultId, quantity: event.shares },
        };

      // Cancellations and refunds are terminal on-chain states, not work for
      // this service. The affected intent picks them up when it next reads the
      // order, which keeps a single source of truth for order state.
      case 'spot.buy_cancelled':
      case 'spot.sell_cancelled':
      case 'vault.refund':
        return null;

      default:
        return null;
    }
  }
}
