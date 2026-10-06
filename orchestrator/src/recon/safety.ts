/**
 * Safety interlocks.
 *
 * Reconciliation detects. These are the controls that *act* on what it found,
 * in the window before a human can.
 *
 * The one that matters: once a backing shortfall is confirmed for a ticker,
 * minting more of it must stop immediately. A shortfall means custodied shares
 * are already fewer than tokens outstanding; every further mint deepens it, and
 * the whole "backed 1:1 by a regulated custodian" claim is what is being
 * eroded. Detection that leaves the mint path open is not a control.
 */

import type { ReconBreak, Store } from '../ports/store.js';

/** Scope key used by the reconciler for a per-ticker backing shortfall. */
export function backingScope(ticker: string): string {
  return `positions:${ticker}:backing`;
}

/** Scope key for a supply-versus-ledger disagreement. */
export function supplyScope(ticker: string): string {
  return `positions:${ticker}:supply`;
}

/**
 * An unresolved backing shortfall for this ticker, if there is one.
 *
 * Only a written resolution clears it — see `Reconciler.resolveBreak`. An
 * acknowledged-but-unresolved break still blocks, because acknowledging a
 * shortfall does not put the shares back.
 */
export async function openBackingBreak(
  store: Store,
  ticker: string,
): Promise<ReconBreak | null> {
  return store.breaks.findOpenByScope('POSITION', backingScope(ticker));
}

/**
 * Every unresolved CRITICAL break, for the readiness probe and the ops view.
 */
export async function openCriticalBreaks(store: Store): Promise<ReconBreak[]> {
  const items = await store.breaks.list({ severity: 'CRITICAL' });
  return items.filter((item) => item.status !== 'RESOLVED');
}

/**
 * Human-readable reason to park an intent that would have minted into a
 * shortfall. Written to be readable by whoever picks up the page at 3am.
 */
export function mintBlockedReason(ticker: string, item: ReconBreak): string {
  return (
    `Minting ${ticker} is blocked by an unresolved backing shortfall ` +
    `(break ${item.id}): ${item.description} ` +
    `Resolve the break with a written explanation before this position is minted.`
  );
}
