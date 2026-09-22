use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::SpotError;
use crate::state::Market;

/// Move collected trading spread to the treasury. Admin only.
///
/// Bounded by `fees_collected - fees_swept`, so a sweep can never reach past
/// earned spread into escrowed customer funds or sale proceeds sitting in the
/// same account awaiting settlement.
pub fn handler(ctx: Context<SweepFee>, amount: u64) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;

    require!(amount > 0, SpotError::ZeroAmount);
    require!(
        amount <= market.fees_outstanding(),
        SpotError::FeeSweepExceedsCollected
    );

    let admin_key = market.admin;
    let ticker = market.ticker.clone();
    let bump = market.bump;
    let seeds = &[b"market".as_ref(), admin_key.as_ref(), ticker.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.market_usdc.to_account_info(),
                to: ctx.accounts.treasury_usdc.to_account_info(),
                authority: market_ai,
            },
            signer,
        ),
        amount,
    )?;

    market.fees_swept = market
        .fees_swept
        .checked_add(amount)
        .ok_or(SpotError::Overflow)?;

    msg!(
        "Swept {} USDC to treasury | {} outstanding",
        amount,
        market.fees_outstanding()
    );
    Ok(())
}

#[derive(Accounts)]
pub struct SweepFee<'info> {
    #[account(
        mut,
        has_one = admin @ SpotError::UnauthorizedAdmin,
        seeds = [b"market", market.admin.as_ref(), market.ticker.as_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(mut, constraint = market_usdc.key() == market.market_usdc)]
    pub market_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = treasury_usdc.owner == market.treasury @ SpotError::UnauthorizedAdmin,
        constraint = treasury_usdc.mint == market_usdc.mint
    )]
    pub treasury_usdc: Box<Account<'info, TokenAccount>>,

    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
