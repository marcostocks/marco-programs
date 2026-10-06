/**
 * Identifiers and counterparty references.
 *
 * Two distinct concepts live here and they must not be confused:
 *
 *   - **Entity ids** are minted once, randomly, and are never recomputed.
 *   - **Client references** are *derived* from an intent and a step name. They
 *     are deterministic, so a retry after a crash produces byte-identical
 *     references and the counterparty's own idempotency layer collapses the
 *     duplicate. This is the primary defence against double-wiring money.
 */

import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export type IdPrefix =
  | 'acct'
  | 'int'
  | 'jrn'
  | 'res'
  | 'brk'
  | 'cnv'
  | 'pay'
  | 'cus'
  | 'rec'
  | 'brk_item'
  | 'evt'
  | 'whk'
  | 'vlt';

export interface IdSource {
  /** Milliseconds since epoch. */
  now(): number;
  /** Cryptographically random bytes. */
  random(length: number): Uint8Array;
}

export const systemIdSource: IdSource = {
  now: () => Date.now(),
  random: (length) => randomBytes(length),
};

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += CROCKFORD[(value << (5 - bits)) & 31];
  return output;
}

/**
 * Lexicographically sortable id: 48-bit timestamp then 80 bits of randomness.
 * Sortability matters because it makes the journal readable in insertion order
 * without a secondary index.
 */
export function newId(prefix: IdPrefix, source: IdSource = systemIdSource): string {
  const timestamp = source.now();
  const timeBytes = new Uint8Array(6);
  let remaining = BigInt(timestamp);
  for (let i = 5; i >= 0; i -= 1) {
    timeBytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  const randomPart = source.random(10);
  const combined = new Uint8Array(16);
  combined.set(timeBytes, 0);
  combined.set(randomPart, 6);
  return `${prefix}_${encodeBase32(combined)}`;
}

/* -------------------------------------------------------------------------- */
/* Deterministic counterparty references                                       */
/* -------------------------------------------------------------------------- */

/**
 * The reference we send to a counterparty for a given logical operation.
 *
 * Identical inputs always produce an identical reference, which is what makes
 * a retry safe: the MSB sees the same `clientRef` on the second call and
 * returns the original conversion instead of creating a second one.
 *
 * `discriminator` exists for the rare case where a step legitimately needs to
 * issue a *new* operation after an earlier one was confirmed dead — a broker
 * rejection followed by a re-place, for instance. Bumping it is an explicit,
 * auditable decision, never an automatic one.
 */
export function clientRef(
  intentId: string,
  step: string,
  discriminator = 0,
): string {
  const base = `${intentId}.${step}`;
  return discriminator === 0 ? base : `${base}.${discriminator}`;
}

/**
 * Compress a reference to fit a counterparty's field-length limit while
 * remaining deterministic and collision-resistant.
 *
 * FIX `ClOrdID` is conventionally capped at 20 characters and many bank
 * payment-reference fields at 16 or 35, so a raw `int_01J…​.place_order` will
 * not fit. The prefix is kept human-readable so an ops desk can still eyeball
 * which environment a reference came from.
 */
export function boundedRef(reference: string, maxLength: number, prefix = 'MRC'): string {
  if (maxLength < prefix.length + 9) {
    throw new Error(`boundedRef needs at least ${prefix.length + 9} characters`);
  }
  if (reference.length <= maxLength) return reference;

  const digestLength = maxLength - prefix.length;
  const digest = createHash('sha256').update(reference).digest();
  return `${prefix}${encodeBase32(digest).slice(0, digestLength)}`;
}

/**
 * Stable fingerprint of a document, used for on-chain attestation.
 *
 * `confirm_buy` requires a non-zero 32-byte document hash. Publishing only the
 * hash lets a holder verify that a contract note they are shown is the one
 * that was attested, without exposing counterparty paperwork on-chain.
 */
export function documentHash(bytes: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes)
    .digest('hex');
}

/** A 32-byte hex string of zeroes — rejected by the on-chain attestation guard. */
export const ZERO_HASH = '0'.repeat(64);

export function isZeroHash(hash: string): boolean {
  return /^0*$/.test(hash);
}

/**
 * Deterministic key for an inbound event, used to dedupe webhook redeliveries.
 * Counterparties retry aggressively; the same delivery must never be applied
 * twice.
 */
export function eventKey(source: string, deliveryId: string): string {
  return `${source}:${deliveryId}`;
}
