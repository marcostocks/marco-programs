use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::SpotError;
use crate::state::{Market, MarketStatus};

/// Market parameters, fixed at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketParams {
    /// HKEX ticker, e.g. "0700.HK".
    pub ticker: String,
    /// Decimals on the position token; 6 matches USDC.
    pub share_decimals: u8,
    /// Trading spread in basis points.
    pub fee_bps: u16,
    pub min_order_usdc: u64,
    /// 0 = no per-order maximum.
    pub max_order_usdc: u64,
}

pub fn handler(ctx: Context<InitializeMarket>, p: MarketParams) -> Result<()> {
    require!(
        !p.ticker.is_empty() && p.ticker.len() <= Market::MAX_TICKER_LEN,
        SpotError::InvalidTicker
    );
    require!(p.fee_bps <= Market::MAX_FEE_BPS, SpotError::FeeTooHigh);
    require!(p.share_decimals <= 9, SpotError::InvalidParameter);
    if p.max_order_usdc > 0 {
        require!(p.max_order_usdc >= p.min_order_usdc, SpotError::InvalidParameter);
    }

    let market = &mut ctx.accounts.market;
    market.bump = ctx.bumps.market;
    market.admin = ctx.accounts.admin.key();
    market.operator = ctx.accounts.operator.key();
    market.treasury = ctx.accounts.treasury.key();
    market.settlement_destination = ctx.accounts.settlement_destination.key();
    market.position_mint = ctx.accounts.position_mint.key();
    market.market_usdc = ctx.accounts.market_usdc.key();
    market.position_escrow = ctx.accounts.position_escrow.key();

    market.ticker = p.ticker;
    market.status = MarketStatus::Active;
    // Phase 1: positions are non-transferable. Lifting this is an explicit
    // admin action, never a default.
    market.transfer_lock = true;
    market.share_decimals = p.share_decimals;
    market.fee_bps = p.fee_bps;
    market.min_order_usdc = p.min_order_usdc;
    market.max_order_usdc = p.max_order_usdc;

    market.total_shares_outstanding = 0;
    market.usdc_escrowed = 0;
    market.shares_escrowed = 0;
    market.total_deployed = 0;
    market.total_bought_usdc = 0;
    market.total_sold_usdc = 0;
    market.fees_collected = 0;
    market.fees_swept = 0;
    market.order_seq = 0;
    market.created_at = Clock::get()?.unix_timestamp;
    market._reserved = [0u8; 128];

    msg!(
        "Market {} created | spread {} bps | settlement {}",
        market.ticker,
        market.fee_bps,
        market.settlement_destination
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(p: MarketParams)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = admin,
        space = Market::MAX_SIZE,
        seeds = [b"market", admin.key().as_ref(), p.ticker.as_bytes()],
        bump
    )]
    pub market: Box<Account<'info, Market>>,

    /// Position-token mint. The market PDA is both mint and freeze
    /// authority — minting is gated on a custody attestation, and the
    /// freeze authority is what locks positions in Phase 1.
    #[account(
        init,
        payer = admin,
        mint::decimals = p.share_decimals,
        mint::authority = market,
        mint::freeze_authority = market,
        seeds = [b"position_mint", market.key().as_ref()],
        bump
    )]
    pub position_mint: Box<Account<'info, Mint>>,

    /// Stablecoin escrow, owned by the market PDA.
    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = market,
        seeds = [b"market_usdc", market.key().as_ref()],
        bump
    )]
    pub market_usdc: Box<Account<'info, TokenAccount>>,

    /// Holds position tokens escrowed against pending sells. Never frozen,
    /// so escrowed tokens can be burned at settlement or returned on cancel.
    #[account(
        init,
        payer = admin,
        token::mint = position_mint,
        token::authority = market,
        seeds = [b"position_escrow", market.key().as_ref()],
        bump
    )]
    pub position_escrow: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// IMMUTABLE conversion-partner USDC account. Only its key is stored;
    /// it is validated as a token account when capital is deployed.
    /// CHECK: recorded as a fixed pubkey, checked at deploy time.
    pub settlement_destination: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: stored as pubkey only.
    pub operator: AccountInfo<'info>,

    /// CHECK: stored as pubkey only.
    pub treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
