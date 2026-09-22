use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::SpotError;
use crate::lock;
use crate::state::{Market, Order, OrderSide, OrderStatus};

/// Cancel a pending sell and return the escrowed position tokens.
///
/// The trader can pull their own order; admin/operator can too, which is
/// what unwinds an order the broker could not fill (a Hong Kong trading
/// halt, say). Nothing was burned, so the position comes back intact.
///
/// The trader's account may be frozen (they still hold other shares) or
/// thawed (a previous sell emptied it). Tokens cannot be transferred into
/// a frozen account, so thaw first and re-lock afterwards.
pub fn handler(ctx: Context<CancelSell>) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;
    let order = &mut ctx.accounts.order;

    require!(order.side == OrderSide::Sell, SpotError::WrongOrderSide);
    require!(order.status == OrderStatus::Pending, SpotError::InvalidOrderStatus);

    let signer_key = ctx.accounts.signer.key();
    require!(
        signer_key == order.trader
            || signer_key == market.admin
            || signer_key == market.operator,
        SpotError::UnauthorizedTrader
    );

    let shares = order.shares_amount;
    require!(shares > 0, SpotError::ZeroAmount);

    let admin_key = market.admin;
    let ticker = market.ticker.clone();
    let bump = market.bump;
    let transfer_lock = market.transfer_lock;
    let seeds = &[b"market".as_ref(), admin_key.as_ref(), ticker.as_bytes(), &[bump]];
    let market_signer = &[&seeds[..]];

    let token_program = ctx.accounts.token_program.to_account_info();
    let mint_ai = ctx.accounts.position_mint.to_account_info();

    lock::thaw_if_frozen(
        &token_program,
        &ctx.accounts.trader_position,
        &mint_ai,
        &market_ai,
        market_signer,
    )?;

    token::transfer(
        CpiContext::new_with_signer(
            token_program.clone(),
            Transfer {
                from: ctx.accounts.position_escrow.to_account_info(),
                to: ctx.accounts.trader_position.to_account_info(),
                authority: market_ai.clone(),
            },
            market_signer,
        ),
        shares,
    )?;

    if transfer_lock {
        lock::freeze_shares(
            &token_program,
            &ctx.accounts.trader_position,
            &mint_ai,
            &market_ai,
            market_signer,
        )?;
    }

    order.status = OrderStatus::Cancelled;
    order.updated_at = Clock::get()?.unix_timestamp;

    market.shares_escrowed = market.shares_escrowed.saturating_sub(shares);

    msg!("Sell #{} cancelled | {} shares returned", order.order_id, shares);

    emit!(crate::events::SellCancelled {
        market: market.key(),
        ticker,
        order_id: order.order_id,
        trader: order.trader,
        shares_returned: shares,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelSell<'info> {
    #[account(
        mut,
        seeds = [b"market", market.admin.as_ref(), market.ticker.as_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"order", market.key().as_ref(), &order.order_id.to_le_bytes()],
        bump = order.bump,
        constraint = order.market == market.key() @ SpotError::InvalidParameter
    )]
    pub order: Box<Account<'info, Order>>,

    #[account(mut, constraint = position_mint.key() == market.position_mint)]
    pub position_mint: Box<Account<'info, Mint>>,

    #[account(mut, constraint = position_escrow.key() == market.position_escrow)]
    pub position_escrow: Box<Account<'info, TokenAccount>>,

    /// Tokens always return to the order's own trader.
    #[account(
        mut,
        constraint = trader_position.owner == order.trader @ SpotError::UnauthorizedTrader,
        constraint = trader_position.mint == market.position_mint
    )]
    pub trader_position: Box<Account<'info, TokenAccount>>,

    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
