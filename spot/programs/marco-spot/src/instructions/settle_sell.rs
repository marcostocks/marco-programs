use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::errors::SpotError;
use crate::state::{Holding, Market, Order, OrderSide, OrderStatus};

/// Settle a sell: the broker sold the share, proceeds returned on-chain,
/// and the escrowed position tokens are burned against the shares leaving
/// custody.
///
/// The proceeds must already be sitting in the market account as UNRESERVED
/// balance — not merely present. If the broker's stablecoins have not
/// arrived, settlement is refused and the order stays Pending rather than
/// paying the seller with another trader's escrowed buy funds.
///
/// The trading spread is taken from the proceeds; the trader receives the
/// net. The execution price may not be below the trader's limit.
pub fn handler(
    ctx: Context<SettleSell>,
    proceeds_usdc: u64,
    execution_price: u64,
    doc_hash: [u8; 32],
) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;
    let order = &mut ctx.accounts.order;

    require!(order.side == OrderSide::Sell, SpotError::WrongOrderSide);
    require!(order.status == OrderStatus::Pending, SpotError::InvalidOrderStatus);
    require!(proceeds_usdc > 0, SpotError::ZeroAmount);
    require!(execution_price > 0, SpotError::InvalidParameter);
    require!(
        execution_price >= order.limit_price,
        SpotError::LimitPriceExceeded
    );
    require!(doc_hash != [0u8; 32], SpotError::InvalidAttestation);

    let shares = order.shares_amount;
    // Rate snapshotted when the sell was placed, not the market's current one.
    let fee = (proceeds_usdc as u128)
        .saturating_mul(order.fee_bps as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;
    let payout = proceeds_usdc.checked_sub(fee).ok_or(SpotError::Overflow)?;
    require!(payout > 0, SpotError::ZeroAmount);

    // The proceeds must genuinely be present as unreserved balance. The
    // market account pools pending buy escrow and earned spread alongside
    // returned proceeds, and an SPL transfer only checks the total — so
    // without this a settlement raised before the broker's funds arrive is
    // paid out of other traders' escrow, leaving their cancel_buy to fail.
    require!(
        market.unreserved_usdc(ctx.accounts.market_usdc.amount) >= proceeds_usdc,
        SpotError::InsufficientUnreservedFunds
    );

    let admin_key = market.admin;
    let ticker = market.ticker.clone();
    let bump = market.bump;
    let seeds = &[b"market".as_ref(), admin_key.as_ref(), ticker.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    let token_program = ctx.accounts.token_program.to_account_info();

    // The escrow is market-owned and never frozen, so it burns directly.
    token::burn(
        CpiContext::new_with_signer(
            token_program.clone(),
            Burn {
                mint: ctx.accounts.position_mint.to_account_info(),
                from: ctx.accounts.position_escrow.to_account_info(),
                authority: market_ai.clone(),
            },
            signer,
        ),
        shares,
    )?;

    token::transfer(
        CpiContext::new_with_signer(
            token_program.clone(),
            Transfer {
                from: ctx.accounts.market_usdc.to_account_info(),
                to: ctx.accounts.trader_usdc.to_account_info(),
                authority: market_ai,
            },
            signer,
        ),
        payout,
    )?;

    order.status = OrderStatus::Settled;
    order.usdc_amount = payout;
    order.execution_price = execution_price;
    order.fee_paid = fee;
    order.doc_hash = doc_hash;
    let now = Clock::get()?.unix_timestamp;
    order.attested_at = now;
    order.updated_at = now;

    market.shares_escrowed = market.shares_escrowed.saturating_sub(shares);
    market.total_shares_outstanding = market.total_shares_outstanding.saturating_sub(shares);
    market.total_sold_usdc = market
        .total_sold_usdc
        .checked_add(payout)
        .ok_or(SpotError::Overflow)?;
    market.fees_collected = market
        .fees_collected
        .checked_add(fee)
        .ok_or(SpotError::Overflow)?;

    let holding = &mut ctx.accounts.holding;
    holding.shares_sold = holding
        .shares_sold
        .checked_add(shares)
        .ok_or(SpotError::Overflow)?;
    holding.usdc_received = holding
        .usdc_received
        .checked_add(payout)
        .ok_or(SpotError::Overflow)?;
    holding.fees_paid = holding
        .fees_paid
        .checked_add(fee)
        .ok_or(SpotError::Overflow)?;

    msg!(
        "Sell #{} settled | {} shares @ {} | {} USDC out, spread {}",
        order.order_id,
        shares,
        execution_price,
        payout,
        fee
    );
    Ok(())
}

#[derive(Accounts)]
pub struct SettleSell<'info> {
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

    #[account(
        mut,
        seeds = [b"holding", market.key().as_ref(), order.trader.as_ref()],
        bump = holding.bump,
        constraint = holding.trader == order.trader @ SpotError::UnauthorizedTrader
    )]
    pub holding: Box<Account<'info, Holding>>,

    #[account(mut, constraint = position_mint.key() == market.position_mint)]
    pub position_mint: Box<Account<'info, Mint>>,

    #[account(mut, constraint = position_escrow.key() == market.position_escrow)]
    pub position_escrow: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = market_usdc.key() == market.market_usdc)]
    pub market_usdc: Box<Account<'info, TokenAccount>>,

    /// Proceeds always go to the order's own trader.
    #[account(
        mut,
        constraint = trader_usdc.owner == order.trader @ SpotError::UnauthorizedTrader,
        constraint = trader_usdc.mint == market_usdc.mint
    )]
    pub trader_usdc: Box<Account<'info, TokenAccount>>,

    pub admin_or_operator: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
