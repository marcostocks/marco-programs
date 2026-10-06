/**
 * Shared shape for inbound counterparty callbacks.
 *
 * Every provider signs differently — HMAC over the raw body, HMAC over
 * `timestamp.body`, an Ed25519 detached signature, mutual TLS. The adapter
 * hides that; the ingest route only ever sees this.
 */

export interface RawWebhook {
  /** The exact bytes received. Never re-serialise before verifying a signature. */
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly receivedAt: string;
}

export interface WebhookVerification {
  readonly valid: boolean;
  /** Provider's own delivery id, used to dedupe redeliveries. */
  readonly deliveryId?: string;
  /** Signed timestamp, if the scheme carries one. Used for replay rejection. */
  readonly signedAt?: string;
  readonly reason?: string;
}

/**
 * A normalised event from a counterparty.
 *
 * `clientRef` is how the event finds its way back to an intent: we generated it
 * deterministically when we made the original request, so the event carries it
 * home without a lookup table. Providers that cannot echo a client reference
 * force us to keep a mapping from their id to ours — the adapter owns that.
 */
export interface CounterpartyEvent<TKind extends string = string, TData = unknown> {
  readonly source: 'msb' | 'broker' | 'custodian';
  readonly kind: TKind;
  readonly deliveryId: string;
  readonly occurredAt: string;
  readonly clientRef?: string;
  readonly providerId?: string;
  readonly data: TData;
}

export interface WebhookCapable {
  verifyWebhook(raw: RawWebhook): WebhookVerification;
  parseWebhook(raw: RawWebhook): CounterpartyEvent[];
}
