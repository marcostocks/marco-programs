use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::errors::SpotError;
use crate::lock;
use crate::state::{Holding, Market, Order, OrderSide, OrderStatus};

/// Attest the custodied position for a deployed buy and mint the trader's
/// position tokens.
///
/// This is the only path that creates position tokens, and it is gated on
/// evidence rather than on payment: deploying capital proves funds were
/// sent, not that a share was acquired. Supply therefore tracks what the
/// custodian actually holds.
///
/// Recorded on-chain: units acquired, execution price, the custodian's
/// position reference, and a fingerprint of the broker confirmation and
/// custodian statement. The documents stay off-chain — publishing only the
/// hash lets a holder verify a document they are shown is genuine and
/// unaltered, without exposing counterparty paperwork.
///
/// Two bounds protect the trader: the execution price may not be worse than
/// the limit they agreed to, and the attested notional may not exceed the
/// capital actually deployed for the order (a fat-finger over-mint guard).
pub fn handler(
    ctx: Context<ConfirmBuy>,
    shares: u64,
    execution_price: u64,
    custody_ref: [u8; 32],
    doc_hash: [u8; 32],
) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;
    let order = &mut ctx.accounts.order;

    require!(order.side == OrderSide::Buy, SpotError::WrongOrderSide);
    require!(order.status == OrderStatus::Deployed, SpotError::InvalidOrderStatus);
    require!(shares > 0, SpotError::ZeroAmount);
    require!(execution_price > 0, SpotError::InvalidParameter);
    require!(
        execution_price <= order.limit_price,
        SpotError::LimitPriceExceeded
    );
    // A position must be evidenced, not asserted.
    require!(
        custody_ref != [0u8; 32] && doc_hash != [0u8; 32],
        SpotError::InvalidAttestation
    );

    let notional = market.notional(shares, execution_price);
    require!(
        notional <= order.deployed_amount,
        SpotError::NotionalMismatch
    );

    let admin_key = market.admin;
    let ticker = market.ticker.clone();
    let bump = market.bump;
    let transfer_lock = market.transfer_lock;
    let seeds = &[b"market".as_ref(), admin_key.as_ref(), ticker.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    let token_program = ctx.accounts.token_program.to_account_info();
    let mint_ai = ctx.accounts.position_mint.to_account_info();

    // A locked position account is frozen, and a frozen account cannot be
    // minted to. Open it, mint, lock it again within this instruction, so
    // the tokens are never transferable in a transaction the trader controls.
    lock::thaw_if_frozen(
        &token_program,
        &ctx.accounts.trader_position,
        &mint_ai,
        &market_ai,
        signer,
    )?;

    token::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            MintTo {
                mint: mint_ai.clone(),
                to: ctx.accounts.trader_position.to_account_info(),
                authority: market_ai.clone(),
            },
            signer,
        ),
        shares,
    )?;

    if transfer_lock {
        lock::freeze_shares(
            &token_program,
            &ctx.accounts.trader_position,
            &mint_ai,
            &market_ai,
            signer,
        )?;
    }

    order.shares_amount = shares;
    order.execution_price = execution_price;
    order.custody_ref = custody_ref;
    order.doc_hash = doc_hash;
    order.status = OrderStatus::Filled;
    let now = Clock::get()?.unix_timestamp;
    order.attested_at = now;
    order.updated_at = now;

    market.total_shares_outstanding = market
        .total_shares_outstanding
        .checked_add(shares)
        .ok_or(SpotError::Overflow)?;
    market.total_bought_usdc = market
        .total_bought_usdc
        .checked_add(order.deployed_amount)
        .ok_or(SpotError::Overflow)?;

    let holding = &mut ctx.accounts.holding;
    holding.shares_bought = holding
        .shares_bought
        .checked_add(shares)
        .ok_or(SpotError::Overflow)?;
    holding.usdc_spent = holding
        .usdc_spent
        .checked_add(order.usdc_amount)
        .ok_or(SpotError::Overflow)?;
    holding.fees_paid = holding
        .fees_paid
        .checked_add(order.fee_paid)
        .ok_or(SpotError::Overflow)?;

    msg!(
        "Buy #{} filled | {} shares @ {} | notional {} of {} deployed",
        order.order_id,
        shares,
        execution_price,
        notional,
        order.deployed_amount
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ConfirmBuy<'info> {
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

    /// The order's own trader receives the position — never an arbitrary
    /// account supplied by the caller.
    #[account(
        mut,
        constraint = trader_position.owner == order.trader @ SpotError::UnauthorizedTrader,
        constraint = trader_position.mint == market.position_mint
    )]
    pub trader_position: Box<Account<'info, TokenAccount>>,

    pub admin_or_operator: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
