use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::SpotError;
use crate::state::{Market, Order, OrderSide, OrderStatus};

/// Cancel a buy and return the trader's stablecoins.
///
/// Two situations reach here:
///
/// - **Pending** — nothing has left the escrow. The trader can pull their
///   own order, and so can admin/operator. Refunds in full; no spread was
///   earned because capital never deployed.
/// - **Deployed** — a leg failed off-chain and the conversion partner or
///   broker returned the funds under the pre-agreed return path. Admin only,
///   since it asserts an off-chain event. The spread is reversed too: it is
///   earned on a completed purchase, not a failed one.
///
/// A Deployed cancel needs the returned USDC to be sitting in the market
/// account; if it is not, the transfer fails and the order stays Deployed
/// rather than being marked cancelled without paying anyone.
pub fn handler(ctx: Context<CancelBuy>) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;
    let order = &mut ctx.accounts.order;

    require!(order.side == OrderSide::Buy, SpotError::WrongOrderSide);

    let signer_key = ctx.accounts.signer.key();
    let is_admin = signer_key == market.admin || signer_key == market.operator;
    let is_trader = signer_key == order.trader;

    let refund = order.usdc_amount;
    require!(refund > 0, SpotError::ZeroAmount);

    match order.status {
        OrderStatus::Pending => {
            require!(is_admin || is_trader, SpotError::UnauthorizedTrader);
            market.usdc_escrowed = market.usdc_escrowed.saturating_sub(refund);
        }
        OrderStatus::Deployed => {
            // Asserts that an off-chain leg failed and funds came back.
            require!(is_admin, SpotError::UnauthorizedAdmin);
            market.total_deployed = market.total_deployed.saturating_sub(order.deployed_amount);
            market.fees_collected = market.fees_collected.saturating_sub(order.fee_paid);
        }
        _ => return Err(SpotError::InvalidOrderStatus.into()),
    }

    let admin_key = market.admin;
    let ticker = market.ticker.clone();
    let bump = market.bump;
    let seeds = &[b"market".as_ref(), admin_key.as_ref(), ticker.as_bytes(), &[bump]];
    let market_signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.market_usdc.to_account_info(),
                to: ctx.accounts.trader_usdc.to_account_info(),
                authority: market_ai,
            },
            market_signer,
        ),
        refund,
    )?;

    order.status = OrderStatus::Cancelled;
    order.fee_paid = 0;
    order.updated_at = Clock::get()?.unix_timestamp;

    msg!("Buy #{} cancelled | {} USDC refunded", order.order_id, refund);
    Ok(())
}

#[derive(Accounts)]
pub struct CancelBuy<'info> {
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

    #[account(mut, constraint = market_usdc.key() == market.market_usdc)]
    pub market_usdc: Box<Account<'info, TokenAccount>>,

    /// Refund always goes to the order's own trader.
    #[account(
        mut,
        constraint = trader_usdc.owner == order.trader @ SpotError::UnauthorizedTrader,
        constraint = trader_usdc.mint == market_usdc.mint
    )]
    pub trader_usdc: Box<Account<'info, TokenAccount>>,

    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
