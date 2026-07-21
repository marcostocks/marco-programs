use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::SpotError;
use crate::lock;
use crate::state::Market;

/// Thaw one holder's position account after admin has lifted the market's
/// transfer lock — the per-holder half of the Phase 1 to Phase 2 move.
///
/// SPL freezes are per-account and cannot be cleared mint-wide, so
/// `set_transfer_lock(false)` alone does not free existing positions; each
/// account has to be thawed individually.
///
/// Permissionless by design: it can only run once admin has already revoked
/// the lock, at which point thawing is purely beneficial to the holder. That
/// lets Marco sweep every holder in a batch without collecting signatures,
/// and lets a holder unlock themselves if Marco does not.
pub fn handler(ctx: Context<UnlockPosition>) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &ctx.accounts.market;
    require!(!market.transfer_lock, SpotError::TransferLockActive);

    let admin_key = market.admin;
    let ticker = market.ticker.clone();
    let bump = market.bump;
    let seeds = &[b"market".as_ref(), admin_key.as_ref(), ticker.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    lock::thaw_if_frozen(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.holder_position,
        &ctx.accounts.position_mint.to_account_info(),
        &market_ai,
        signer,
    )?;

    msg!("Position unlocked for {}", ctx.accounts.holder_position.key());
    Ok(())
}

#[derive(Accounts)]
pub struct UnlockPosition<'info> {
    #[account(
        seeds = [b"market", market.admin.as_ref(), market.ticker.as_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(constraint = position_mint.key() == market.position_mint)]
    pub position_mint: Box<Account<'info, Mint>>,

    /// Constrained to this market's position mint, so the instruction can
    /// never touch an unrelated token account.
    #[account(mut, constraint = holder_position.mint == market.position_mint)]
    pub holder_position: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
