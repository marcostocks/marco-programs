use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod lock;
pub mod state;

use instructions::*;
use state::MarketStatus;

declare_id!("44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e");

/// Marco Spot Stocks.
///
/// One market per HKEX-listed security. Traders buy with stablecoins; a
/// licensed conversion partner crosses to HKD, an SFC-licensed broker buys
/// the real share on HKEX as principal, and a regulated custodian holds it
/// 1:1 in segregated custody. Only once that holding is attested on-chain is
/// a position token minted — so supply tracks custodied shares, not intent.
///
/// In Phase 1 the position token is non-transferable, locked to the holder's
/// wallet. Phase 2 lifts the lock into a freely tradable, composable token.
#[program]
pub mod marco_spot {
    use super::*;

    /// Create a market for one security. PDA seeds: [b"market", admin, ticker].
    /// `settlement_destination` (the conversion partner) is fixed here forever.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: instructions::initialize_market::MarketParams,
    ) -> Result<()> {
        instructions::initialize_market::handler(ctx, params)
    }

    /// Record a trader's eligibility after off-chain identity verification.
    /// Keyed by admin, so one verification covers every market.
    pub fn register_trader(
        ctx: Context<RegisterTrader>,
        eligible: bool,
        jurisdiction: u16,
    ) -> Result<()> {
        instructions::register_trader::handler(ctx, eligible, jurisdiction)
    }

    // ── Buy ────────────────────────────────────────────────────────

    /// Submit a buy: escrow stablecoins and open an order. Nothing is
    /// deployed and no position exists yet.
    ///
    /// `min_shares_out` is mandatory slippage protection — a price cap alone
    /// does not constrain how many shares come back.
    pub fn place_buy(
        ctx: Context<PlaceBuy>,
        order_id: u64,
        usdc_amount: u64,
        limit_price: u64,
        min_shares_out: u64,
    ) -> Result<()> {
        instructions::place_buy::handler(ctx, order_id, usdc_amount, limit_price, min_shares_out)
    }

    /// Send the escrowed stablecoins to the immutable conversion-partner
    /// account and take the trading spread. Pending -> Deployed.
    pub fn deploy_buy(ctx: Context<DeployBuy>) -> Result<()> {
        instructions::deploy_buy::handler(ctx)
    }

    /// Attest the custodied position and mint the trader's position tokens.
    /// Deployed -> Filled. The only path that creates position tokens.
    pub fn confirm_buy(
        ctx: Context<ConfirmBuy>,
        shares: u64,
        execution_price: u64,
        custody_ref: [u8; 32],
        doc_hash: [u8; 32],
    ) -> Result<()> {
        instructions::confirm_buy::handler(ctx, shares, execution_price, custody_ref, doc_hash)
    }

    /// Cancel a buy and refund the trader. Pending (trader or admin) or
    /// Deployed (admin only, after a failed off-chain leg returns funds).
    pub fn cancel_buy(ctx: Context<CancelBuy>) -> Result<()> {
        instructions::cancel_buy::handler(ctx)
    }

    // ── Sell ───────────────────────────────────────────────────────

    /// Submit a sell: escrow position tokens while the broker sells the
    /// underlying. Tokens are burned at settlement, not here.
    pub fn place_sell(
        ctx: Context<PlaceSell>,
        order_id: u64,
        shares: u64,
        limit_price: u64,
    ) -> Result<()> {
        instructions::place_sell::handler(ctx, order_id, shares, limit_price)
    }

    /// Settle a sell: burn the escrowed tokens and pay the trader the
    /// proceeds net of the spread. Pending -> Settled.
    pub fn settle_sell(
        ctx: Context<SettleSell>,
        proceeds_usdc: u64,
        execution_price: u64,
        doc_hash: [u8; 32],
    ) -> Result<()> {
        instructions::settle_sell::handler(ctx, proceeds_usdc, execution_price, doc_hash)
    }

    /// Cancel a pending sell and return the escrowed position tokens.
    pub fn cancel_sell(ctx: Context<CancelSell>) -> Result<()> {
        instructions::cancel_sell::handler(ctx)
    }

    // ── Admin ──────────────────────────────────────────────────────

    /// Open, pause or close the market. A HK trading halt maps to Paused.
    pub fn set_market_status(ctx: Context<AdminAction>, status: MarketStatus) -> Result<()> {
        instructions::admin::set_market_status(ctx, status)
    }

    /// Rotate the operator wallet.
    pub fn update_operator(ctx: Context<AdminAction>, new_operator: Pubkey) -> Result<()> {
        instructions::admin::update_operator(ctx, new_operator)
    }

    /// Adjust the trading spread, within the hard cap.
    pub fn set_fee_bps(ctx: Context<AdminAction>, fee_bps: u16) -> Result<()> {
        instructions::admin::set_fee_bps(ctx, fee_bps)
    }

    /// Lock/unlock position tokens — the Phase 1 to Phase 2 switch. Clearing
    /// it stops new freezes; existing accounts still need `unlock_position`.
    pub fn set_transfer_lock(ctx: Context<AdminAction>, locked: bool) -> Result<()> {
        instructions::admin::set_transfer_lock(ctx, locked)
    }

    /// Thaw one holder's position once the transfer lock has been lifted.
    /// Permissionless — it only works after admin unlocks.
    pub fn unlock_position(ctx: Context<UnlockPosition>) -> Result<()> {
        instructions::unlock_position::handler(ctx)
    }

    /// Sweep collected trading spread to the treasury.
    pub fn sweep_fee(ctx: Context<SweepFee>, amount: u64) -> Result<()> {
        instructions::sweep_fee::handler(ctx, amount)
    }
}
