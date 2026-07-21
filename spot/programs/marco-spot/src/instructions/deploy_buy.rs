use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::SpotError;
use crate::state::{Market, Order, OrderSide, OrderStatus};

/// Send a pending buy's escrowed stablecoins to the conversion partner.
///
/// The trading spread is taken here rather than at submission: it is earned
/// only once capital actually leaves for the deal, so a buy cancelled before
/// this point refunds in full. The remainder stays in the market account and
/// is swept to treasury separately.
///
/// Funds can only ever go to `settlement_destination`, fixed at market
/// creation — this instruction cannot be pointed anywhere else.
pub fn handler(ctx: Context<DeployBuy>) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;

    require!(
        ctx.accounts.destination.key() == market.settlement_destination,
        SpotError::WrongDestination
    );

    let order = &mut ctx.accounts.order;
    require!(order.side == OrderSide::Buy, SpotError::WrongOrderSide);
    require!(order.status == OrderStatus::Pending, SpotError::InvalidOrderStatus);

    let gross = order.usdc_amount;
    // Rate snapshotted at placement, not the market's current rate — a later
    // set_fee_bps must not re-price an order the trader already committed to.
    let fee = (gross as u128)
        .saturating_mul(order.fee_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;
    let deployable = gross.checked_sub(fee).ok_or(SpotError::Overflow)?;
    require!(deployable > 0, SpotError::ZeroAmount);

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
                to: ctx.accounts.destination.to_account_info(),
                authority: market_ai,
            },
            signer,
        ),
        deployable,
    )?;

    order.status = OrderStatus::Deployed;
    order.deployed_amount = deployable;
    order.fee_paid = fee;
    order.updated_at = Clock::get()?.unix_timestamp;

    // The whole gross leaves escrow: part as the spread (retained), the
    // rest wired out to the conversion partner.
    market.usdc_escrowed = market.usdc_escrowed.saturating_sub(gross);
    market.total_deployed = market
        .total_deployed
        .checked_add(deployable)
        .ok_or(SpotError::Overflow)?;
    market.fees_collected = market
        .fees_collected
        .checked_add(fee)
        .ok_or(SpotError::Overflow)?;

    msg!(
        "Buy #{} deployed | {} USDC to conversion partner | spread {}",
        order.order_id,
        deployable,
        fee
    );
    Ok(())
}

#[derive(Accounts)]
pub struct DeployBuy<'info> {
    #[account(
        mut,
        seeds = [b"market", market.admin.as_ref(), market.ticker.as_bytes()],
        bump = market.bump,
        constraint = (admin_or_operator.key() == market.admin
            || admin_or_operator.key() == market.operator) @ SpotError::UnauthorizedOperator
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(
        mut,
        seeds = [b"order", market.key().as_ref(), &order.order_id.to_le_bytes()],
        bump = order.bump,
        constraint = order.market == market.key() @ SpotError::InvalidParameter
    )]
    pub order: Box<Account<'info, Order>>,

    #[account(mut, constraint = market_usdc.key() == market.market_usdc)]
    pub market_usdc: Box<Account<'info, TokenAccount>>,

    /// Must be the market's immutable settlement destination.
    #[account(mut)]
    pub destination: Box<Account<'info, TokenAccount>>,

    pub admin_or_operator: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
