use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::SpotError;
use crate::state::{Holding, Market, Order, OrderSide, OrderStatus, TraderAccount};

/// Submit a buy. Stablecoins move into the market escrow and an order is
/// opened; nothing is deployed and no position exists yet.
///
/// `limit_price` is the highest price per share the trader will accept and
/// is enforced against the attested execution price at `confirm_buy`, so a
/// fill can never be booked at a worse price than the trader agreed to.
///
/// The full amount sits in escrow — the trading spread is only taken when
/// capital actually deploys, so a cancelled order refunds in full.
pub fn handler(
    ctx: Context<PlaceBuy>,
    order_id: u64,
    usdc_amount: u64,
    limit_price: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.require_active()?;

    // The order PDA is seeded by this id, so pinning it to the market's
    // counter keeps ids dense and stops a caller choosing their own slot.
    require!(order_id == market.order_seq, SpotError::InvalidParameter);
    require!(usdc_amount > 0, SpotError::ZeroAmount);
    require!(usdc_amount >= market.min_order_usdc, SpotError::BelowMinimum);
    if market.max_order_usdc > 0 {
        require!(usdc_amount <= market.max_order_usdc, SpotError::AboveMaximum);
    }
    require!(limit_price > 0, SpotError::InvalidParameter);
    require!(ctx.accounts.trader_account.eligible, SpotError::TraderNotEligible);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.trader_usdc.to_account_info(),
                to: ctx.accounts.market_usdc.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        usdc_amount,
    )?;

    let now = Clock::get()?.unix_timestamp;
    let order = &mut ctx.accounts.order;
    order.bump = ctx.bumps.order;
    order.market = market.key();
    order.trader = ctx.accounts.trader.key();
    order.order_id = order_id;
    order.side = OrderSide::Buy;
    order.status = OrderStatus::Pending;
    order.usdc_amount = usdc_amount;
    order.shares_amount = 0;
    order.limit_price = limit_price;
    order.execution_price = 0;
    order.fee_paid = 0;
    order.deployed_amount = 0;
    order.custody_ref = [0u8; 32];
    order.doc_hash = [0u8; 32];
    order.created_at = now;
    order.updated_at = now;
    order.attested_at = 0;
    order._reserved = [0u8; 64];

    let holding = &mut ctx.accounts.holding;
    holding.bump = ctx.bumps.holding;
    holding.market = market.key();
    holding.trader = ctx.accounts.trader.key();

    market.usdc_escrowed = market
        .usdc_escrowed
        .checked_add(usdc_amount)
        .ok_or(SpotError::Overflow)?;
    market.order_seq = market.order_seq.checked_add(1).ok_or(SpotError::Overflow)?;

    msg!(
        "Buy #{} placed on {} | {} USDC escrowed | limit {}",
        order_id,
        market.ticker,
        usdc_amount,
        limit_price
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct PlaceBuy<'info> {
    #[account(
        mut,
        seeds = [b"market", market.admin.as_ref(), market.ticker.as_bytes()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        init,
        payer = trader,
        space = Order::MAX_SIZE,
        seeds = [b"order", market.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub order: Box<Account<'info, Order>>,

    #[account(
        init_if_needed,
        payer = trader,
        space = Holding::MAX_SIZE,
        seeds = [b"holding", market.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub holding: Box<Account<'info, Holding>>,

    /// Eligibility is keyed by the market's admin, so one verification
    /// covers every market in the deployment.
    #[account(
        seeds = [b"trader", market.admin.as_ref(), trader.key().as_ref()],
        bump = trader_account.bump,
        constraint = trader_account.admin == market.admin @ SpotError::UnauthorizedTrader,
        constraint = trader_account.trader == trader.key() @ SpotError::UnauthorizedTrader
    )]
    pub trader_account: Box<Account<'info, TraderAccount>>,

    #[account(
        mut,
        constraint = trader_usdc.owner == trader.key(),
        constraint = trader_usdc.mint == market_usdc.mint
    )]
    pub trader_usdc: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = market_usdc.key() == market.market_usdc)]
    pub market_usdc: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
