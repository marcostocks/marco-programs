use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::VaultError;
use crate::lock;
use crate::state::Vault;

/// Thaw one holder's claim-token account after the admin has lifted the
/// vault's transfer lock.
///
/// SPL freezes are per-account and cannot be cleared mint-wide, so
/// `set_transfer_lock(false)` alone does not free existing balances — each
/// account has to be thawed individually. This instruction does that one
/// account at a time.
///
/// Permissionless by design: it can only run once the admin has already
/// revoked the lock, at which point thawing is purely beneficial to the
/// holder. That lets Marco sweep every holder in a batch without collecting
/// signatures, and lets a holder unlock themselves if Marco does not.
pub fn handler(ctx: Context<UnlockShares>) -> Result<()> {
    let vault_ai = ctx.accounts.vault.to_account_info();
    let vault = &ctx.accounts.vault;
    require!(!vault.transfer_lock, VaultError::TransferLockActive);

    let admin_key = vault.admin;
    let vault_id = vault.vault_id.clone();
    let bump = vault.bump;
    let seeds = &[b"vault".as_ref(), admin_key.as_ref(), vault_id.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    lock::thaw_if_frozen(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.holder_shares,
        &ctx.accounts.share_mint.to_account_info(),
        &vault_ai,
        signer,
    )?;

    msg!("Claim tokens unlocked for {}", ctx.accounts.holder_shares.key());
    Ok(())
}

#[derive(Accounts)]
pub struct UnlockShares<'info> {
    #[account(
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(constraint = share_mint.key() == vault.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    /// The holder account to thaw. Constrained to this vault's claim mint,
    /// so the instruction can never touch an unrelated token account.
    #[account(mut, constraint = holder_shares.mint == vault.share_mint)]
    pub holder_shares: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
