use anchor_lang::prelude::*;

use crate::errors::SpotError;
use crate::state::{Market, MarketStatus};

/// Open, pause or close the market. Admin only.
///
/// A Hong Kong trading halt maps to `Paused`: no new orders, but in-flight
/// orders can still settle or cancel, so a halt never traps capital that has
/// already left a wallet.
pub fn set_market_status(ctx: Context<AdminAction>, status: MarketStatus) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.status = status;
    msg!("Market {} status -> {:?}", market.ticker, status);
    Ok(())
}

/// Rotate the operator wallet. Admin only.
pub fn update_operator(ctx: Context<AdminAction>, new_operator: Pubkey) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.operator = new_operator;
    msg!("Operator updated to {}", new_operator);
    Ok(())
}

/// Adjust the trading spread, within the hard cap. Admin only.
///
/// Applies to orders deployed or settled after this point; orders already
/// deployed keep the spread recorded on them.
pub fn set_fee_bps(ctx: Context<AdminAction>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= Market::MAX_FEE_BPS, SpotError::FeeTooHigh);
    let market = &mut ctx.accounts.market;
    market.fee_bps = fee_bps;
    msg!("Market {} spread -> {} bps", market.ticker, fee_bps);
    Ok(())
}

/// Lock or unlock position tokens in holders' wallets — the Phase 1 to
/// Phase 2 switch. Admin only.
///
/// While locked (the default from creation), every position account is
/// frozen on mint, so a position records custodied ownership but cannot be
/// transferred or traded on.
///
/// SPL freezes are per-account and cannot be applied or cleared mint-wide,
/// so this flag governs future freezes only — it never rewrites existing
/// accounts:
///
/// - Setting it false stops new freezes but does not thaw already-frozen
///   accounts. Each holder still needs an `unlock_position` call, which this
///   flag is the precondition for.
/// - Setting it true again does not retroactively re-freeze accounts that
///   were already thawed. They are re-locked the next time they pass through
///   confirm_buy, place_sell or cancel_sell, and are transferable until then.
///
/// Treat the Phase 2 unlock as effectively one-way: once holders are thawed,
/// re-locking them is not something this instruction can guarantee alone.
pub fn set_transfer_lock(ctx: Context<AdminAction>, locked: bool) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.transfer_lock = locked;
    msg!(
        "Market {} positions {}",
        market.ticker,
        if locked { "LOCKED" } else { "UNLOCKED (holders must call unlock_position)" }
    );
    Ok(())
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = admin @ SpotError::UnauthorizedAdmin,
        seeds = [b"market", market.admin.as_ref(), market.ticker.as_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    pub admin: Signer<'info>,
}
