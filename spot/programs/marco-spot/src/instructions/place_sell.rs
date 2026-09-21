use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::SpotError;
use crate::lock;
use crate::state::{Holding, Market, Order, OrderSide, OrderStatus, TraderAccount};

/// Submit a sell. Position tokens move into the market escrow while the
/// broker sells the underlying share.
///
/// The tokens are escrowed rather than burned, so total supply keeps
/// matching the custodian's holding for as long as the share is actually
/// held. They are burned at settlement, when the share genuinely leaves
/// custody — and returned intact if the order is cancelled.
///
/// `limit_price` is the lowest price per share the trader will accept, and
/// is enforced against the attested execution price at settlement.
pub fn handler(
    ctx: Context<PlaceSell>,
    order_id: u64,
    shares: u64,
    limit_price: u64,
) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;
    market.require_active()?;

    require!(order_id == market.order_seq, SpotError::InvalidParameter);
    require!(shares > 0, SpotError::ZeroAmount);
    require!(
        ctx.accounts.trader_position.amount >= shares,
        SpotError::InsufficientShares
    );
    require!(ctx.accounts.trader_account.eligible, SpotError::TraderNotEligible);

    let admin_key = market.admin;
    let ticker = market.ticker.clone();
    let bump = market.bump;
    let transfer_lock = market.transfer_lock;
    let seeds = &[b"market".as_ref(), admin_key.as_ref(), ticker.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    let token_program = ctx.accounts.token_program.to_account_info();
    let mint_ai = ctx.accounts.position_mint.to_account_info();
    let remaining = ctx.accounts.trader_position.amount.saturating_sub(shares);

    // Locked positions are frozen and cannot be transferred out. Thaw,
    // move to escrow, then re-lock whatever balance is left behind.
    lock::thaw_if_frozen(
        &token_program,
        &ctx.accounts.trader_position,
        &mint_ai,
        &market_ai,
        signer,
    )?;

    token::transfer(
        CpiContext::new(
            token_program.clone(),
            Transfer {
                from: ctx.accounts.trader_position.to_account_info(),
                to: ctx.accounts.position_escrow.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        shares,
    )?;

    // Only re-freeze if tokens remain — a frozen account cannot be closed,
    // so re-locking an emptied one would strand the trader's rent.
    if transfer_lock && remaining > 0 {
        lock::freeze_shares(
            &token_program,
            &ctx.accounts.trader_position,
            &mint_ai,
            &market_ai,
            signer,
        )?;
    }

    let now = Clock::get()?.unix_timestamp;
    let order = &mut ctx.accounts.order;
    order.bump = ctx.bumps.order;
    order.market = market.key();
    order.trader = ctx.accounts.trader.key();
    order.order_id = order_id;
    order.side = OrderSide::Sell;
    order.status = OrderStatus::Pending;
    order.usdc_amount = 0;
    order.shares_amount = shares;
    order.limit_price = limit_price;
    order.min_shares_out = 0; // buy-side concept only
    order.fee_bps = market.fee_bps; // snapshot; a later set_fee_bps must not re-price this
    order.execution_price = 0;
    order.fee_paid = 0;
    order.deployed_amount = 0;
    order.custody_ref = [0u8; 32];
    order.doc_hash = [0u8; 32];
    order.created_at = now;
    order.updated_at = now;
    order.attested_at = 0;
    order._reserved = [0u8; 54];

    let holding = &mut ctx.accounts.holding;
    holding.bump = ctx.bumps.holding;
    holding.market = market.key();
    holding.trader = ctx.accounts.trader.key();

    market.shares_escrowed = market
        .shares_escrowed
        .checked_add(shares)
        .ok_or(SpotError::Overflow)?;
    market.order_seq = market.order_seq.checked_add(1).ok_or(SpotError::Overflow)?;

    msg!(
        "Sell #{} placed on {} | {} shares escrowed | limit {}",
        order_id,
        market.ticker,
        shares,
        limit_price
    );

    emit!(crate::events::SellPlaced {
        market: market.key(),
        ticker,
        order_id,
        trader: ctx.accounts.trader.key(),
        shares,
        limit_price,
        fee_bps: order.fee_bps,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct PlaceSell<'info> {
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

    #[account(
        seeds = [b"trader", market.admin.as_ref(), trader.key().as_ref()],
        bump = trader_account.bump,
        constraint = trader_account.admin == market.admin @ SpotError::UnauthorizedTrader,
        constraint = trader_account.trader == trader.key() @ SpotError::UnauthorizedTrader
    )]
    pub trader_account: Box<Account<'info, TraderAccount>>,

    #[account(mut, constraint = position_mint.key() == market.position_mint)]
    pub position_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = trader_position.owner == trader.key(),
        constraint = trader_position.mint == market.position_mint
    )]
    pub trader_position: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = position_escrow.key() == market.position_escrow)]
    pub position_escrow: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub trader: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
