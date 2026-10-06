/**
 * Inbound webhook ingest.
 *
 * Four gates, in order, and none of them is optional:
 *
 *  1. **Signature** — verified by the adapter against the *raw* bytes. Never
 *     re-serialise a body before verifying it; JSON round-tripping reorders
 *     keys and invalidates the signature, and the tempting fix is to skip the
 *     check.
 *  2. **Replay window** — a signed timestamp outside tolerance is rejected, so
 *     a captured delivery cannot be resent later.
 *  3. **Delivery dedupe** — counterparties retry aggressively. Applying the
 *     same fill twice would double a position.
 *  4. **Effect** — the event only ever *wakes* the owning intent. It never
 *     mutates money directly, because a webhook is a hint that state changed,
 *     not a trustworthy statement of what it changed to. The saga re-reads the
 *     counterparty and decides for itself.
 */

import { WebhookVerificationError } from '../domain/errors.js';
import { eventKey } from '../domain/ids.js';
import type { CounterpartyEvent, RawWebhook, WebhookCapable } from '../ports/webhook.js';
import type { Services } from '../services.js';

export type WebhookSource = 'msb' | 'broker' | 'custodian';

export interface IngestResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly woken: string[];
}

export class WebhookIngest {
  constructor(private readonly services: Services) {}

  private providerFor(source: WebhookSource): WebhookCapable {
    switch (source) {
      case 'msb':
        return this.services.msb;
      case 'broker':
        return this.services.broker;
      case 'custodian':
        return this.services.custodian;
    }
  }

  async ingest(source: WebhookSource, raw: RawWebhook): Promise<IngestResult> {
    const { store, clock, logger, config } = this.services;
    const provider = this.providerFor(source);

    const verification = provider.verifyWebhook(raw);
    if (!verification.valid) {
      throw new WebhookVerificationError(verification.reason ?? 'Signature verification failed', {
        source,
      });
    }

    if (verification.signedAt) {
      const ageSeconds = Math.abs(
        (clock.nowMillis() - new Date(verification.signedAt).getTime()) / 1000,
      );
      if (ageSeconds > config.webhooks.toleranceSeconds) {
        throw new WebhookVerificationError(
          `Signed ${Math.round(ageSeconds)}s ago, outside the ${config.webhooks.toleranceSeconds}s replay window`,
          { source },
        );
      }
    }

    const events = provider.parseWebhook(raw);
    let accepted = 0;
    let duplicates = 0;
    const woken: string[] = [];

    for (const event of events) {
      const key = eventKey(source, event.deliveryId);
      const claimed = await store.processedEvents.claim({
        key,
        source,
        receivedAt: clock.nowIso(),
        intentId: null,
      });

      if (!claimed) {
        duplicates += 1;
        logger.debug({ source, deliveryId: event.deliveryId }, 'Dropped a duplicate delivery');
        continue;
      }

      accepted += 1;
      const intentId = await this.wake(event);
      if (intentId) woken.push(intentId);
    }

    return { accepted, duplicates, woken };
  }

  /**
   * Find the intent this event belongs to and make it due immediately.
   *
   * The link is `clientRef`: we generated it deterministically as
   * `<intentId>.<step>[.<sub>]` when we made the original request, so the
   * event carries its own routing information and no mapping table is needed.
   */
  private async wake(event: CounterpartyEvent): Promise<string | null> {
    const { store, clock, logger } = this.services;
    if (!event.clientRef) return null;

    const intentId = event.clientRef.split('.')[0];
    if (!intentId) return null;

    const intent = await store.intents.get(intentId);
    if (!intent) {
      logger.warn(
        { clientRef: event.clientRef, source: event.source, kind: event.kind },
        'Webhook referenced an intent we do not have',
      );
      return null;
    }

    // A parked or finished intent is not woken by a counterparty event. Both
    // states are deliberate stopping points that only an operator may leave.
    if (intent.state !== 'WAITING' && intent.state !== 'RUNNING') return null;

    await store.intents.save({ ...intent, nextAttemptAt: clock.nowIso() }, intent.version);
    logger.info(
      { intentId, source: event.source, kind: event.kind },
      'Woke an intent from a counterparty event',
    );
    return intentId;
  }
}
