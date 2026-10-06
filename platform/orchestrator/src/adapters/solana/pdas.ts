/**
 * PDA derivation for both programs.
 *
 * Seeds are transcribed from the `#[account(seeds = …)]` constraints in the
 * program source, not from documentation. A seed that drifts from the program
 * produces a valid-looking address that simply holds nothing, so these are
 * covered by a test that derives against the live validator.
 */

import { PublicKey } from '@solana/web3.js';

const enc = (s: string) => Buffer.from(s);

/* -------------------------------------------------------------------------- */
/* marco-vault                                                                 */
/* -------------------------------------------------------------------------- */

/** `["vault", admin, vault_id]` */
export function vaultPda(programId: PublicKey, admin: PublicKey, vaultId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc('vault'), admin.toBuffer(), enc(vaultId)],
    programId,
  )[0];
}

/** `["share_mint", vault]` */
export function shareMintPda(programId: PublicKey, vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([enc('share_mint'), vault.toBuffer()], programId)[0];
}

/** `["buyer", vault, depositor]` */
export function buyerStatePda(
  programId: PublicKey,
  vault: PublicKey,
  depositor: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc('buyer'), vault.toBuffer(), depositor.toBuffer()],
    programId,
  )[0];
}

/* -------------------------------------------------------------------------- */
/* marco-spot                                                                  */
/* -------------------------------------------------------------------------- */

/** `["market", admin, ticker]` */
export function marketPda(programId: PublicKey, admin: PublicKey, ticker: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc('market'), admin.toBuffer(), enc(ticker)],
    programId,
  )[0];
}

/** `["position_mint", market]` */
export function positionMintPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([enc('position_mint'), market.toBuffer()], programId)[0];
}

/** `["market_usdc", market]` */
export function marketUsdcPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([enc('market_usdc'), market.toBuffer()], programId)[0];
}

/** `["position_escrow", market]` */
export function positionEscrowPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc('position_escrow'), market.toBuffer()],
    programId,
  )[0];
}

/**
 * `["order", market, order_id.to_le_bytes()]`
 *
 * The order id is a u64 little-endian on-chain. The orchestrator carries order
 * ids as strings, so the conversion happens here rather than at each call site.
 */
export function orderPda(programId: PublicKey, market: PublicKey, orderId: bigint): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(orderId);
  return PublicKey.findProgramAddressSync([enc('order'), market.toBuffer(), id], programId)[0];
}

/** `["holding", market, trader]` */
export function holdingPda(
  programId: PublicKey,
  market: PublicKey,
  trader: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc('holding'), market.toBuffer(), trader.toBuffer()],
    programId,
  )[0];
}

/**
 * `["trader", admin, trader]`
 *
 * Keyed by admin rather than by market, so one verification covers every
 * market.
 */
export function traderAccountPda(
  programId: PublicKey,
  admin: PublicKey,
  trader: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc('trader'), admin.toBuffer(), trader.toBuffer()],
    programId,
  )[0];
}
