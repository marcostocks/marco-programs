use anchor_lang::prelude::*;

use crate::errors::SpotError;

// ═══════════════════════════════════════════════════════════════
// MARCO SPOT STATE
//
// One market == one HKEX-listed security (e.g. "0700.HK"), paired
// with one licensed conversion partner, one SFC-licensed broker and
// one regulated custodian.
//
// The program owns the on-chain leg only: stablecoin escrow, order
// state, the custody attestation, and issuance/redemption of the
// position token. Buying the real share, holding it 1:1 in segregated
// custody and selling it are off-chain, regulated functions.
//
// The defining property is that a position is NEVER minted on the
// strength of a payment alone. Capital leaving the escrow proves only
// that funds were sent; the position token is minted only once the
// custodian's holding has been attested on-chain (`confirm_buy`). So
// the token supply tracks custodied shares rather than intent.
//
// Security notes:
// - `admin` is expected to be a Squads multisig; the program treats it
//   as a single authority and keeps no threshold logic of its own.
// - `settlement_destination` (the conversion partner's USDC account) is
//   fixed at creation and can never be changed.
// - Position tokens are locked in the holder's wallet in Phase 1 (the
//   market PDA holds the SPL freeze authority). Phase 2 lifts the lock.
// ═══════════════════════════════════════════════════════════════

/// Whether a market is accepting new orders.
///
/// A Hong Kong trading halt maps to `Paused`: no new orders are taken,
/// but orders already in flight can still settle or be cancelled, so a
/// halt never strands capital that has already left a wallet.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    /// Normal operation — new buys and sells accepted.
    Active,
    /// No new orders. In-flight orders may still settle or cancel.
    Paused,
    /// Market wound down (e.g. delisting). No new orders, ever.
    Closed,
}

impl Default for MarketStatus {
    fn default() -> Self {
        MarketStatus::Active
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderSide {
    Buy,
    Sell,
}

/// Order lifecycle. Buys and sells share the enum but walk different paths:
///
/// ```text
/// Buy:   Pending ─deploy_buy─▶ Deployed ─confirm_buy─▶ Filled
///          └──────────── cancel_buy ────────────┘ ─▶ Cancelled
///
/// Sell:  Pending ─settle_sell──────────────────────▶ Settled
///          └─ cancel_sell ─▶ Cancelled
/// ```
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderStatus {
    /// Submitted; funds (buy) or position tokens (sell) are escrowed.
    Pending,
    /// Buy only: stablecoins sent to the conversion partner.
    Deployed,
    /// Buy only: custody attested, position tokens minted. Terminal.
    Filled,
    /// Sell only: shares sold, proceeds paid out. Terminal.
    Settled,
    /// Cancelled; escrow returned. Terminal.
    Cancelled,
}

#[account]
pub struct Market {
    /// PDA bump.
    pub bump: u8,

    /// Controlling authority — expected to be a Squads multisig PDA.
    pub admin: Pubkey,

    /// Operator wallet — may deploy capital and confirm fills.
    pub operator: Pubkey,

    /// Treasury wallet — receives swept trading-spread fees.
    pub treasury: Pubkey,

    /// IMMUTABLE conversion-partner USDC account. Escrowed stablecoins
    /// can only ever be sent here. Set once at creation, never mutated.
    pub settlement_destination: Pubkey,

    /// SPL mint for this market's position token.
    pub position_mint: Pubkey,

    /// The market's USDC account (PDA, owned by the market).
    pub market_usdc: Pubkey,

    /// Position tokens escrowed against pending sells (PDA, market-owned).
    pub position_escrow: Pubkey,

    /// HKEX ticker, e.g. "0700.HK".
    pub ticker: String,

    /// Whether the market is accepting new orders.
    pub status: MarketStatus,

    /// Phase 1: position tokens are frozen in the holder's wallet on mint.
    /// Phase 2: admin clears this and holders thaw via `unlock_position`.
    pub transfer_lock: bool,

    /// Decimals on the position token. Matches USDC (6) so fractional
    /// share quantities are expressible.
    pub share_decimals: u8,

    /// Trading spread charged in-contract, in basis points.
    pub fee_bps: u16,

    /// Minimum USDC a single buy must intend (anti-dust).
    pub min_order_usdc: u64,

    /// Maximum USDC for a single buy (0 = no limit).
    pub max_order_usdc: u64,

    /// Position tokens minted and outstanding. Reconciles 1:1 against the
    /// shares the custodian reports holding.
    pub total_shares_outstanding: u64,

    /// USDC held against Pending buy orders (not yet deployed).
    pub usdc_escrowed: u64,

    /// Position tokens held against Pending sell orders.
    pub shares_escrowed: u64,

    /// USDC sent to the conversion partner over the market's life.
    pub total_deployed: u64,

    /// Lifetime USDC spent on filled buys (net of fee).
    pub total_bought_usdc: u64,

    /// Lifetime USDC paid out on settled sells (net of fee).
    pub total_sold_usdc: u64,

    /// Trading spread collected, awaiting sweep.
    pub fees_collected: u64,

    /// Trading spread swept to treasury.
    pub fees_swept: u64,

    /// Monotonic order counter — seeds the per-order PDA.
    pub order_seq: u64,

    /// Unix ts the market was created.
    pub created_at: i64,

    /// Reserved for forward-compatible upgrades.
    pub _reserved: [u8; 128],
}

impl Market {
    /// 8 (disc) + 1 (bump) + 32*7 (pubkeys) + 4+16 (ticker) + 1 (status)
    /// + 1 (transfer_lock) + 1 (share_decimals) + 2 (fee_bps)
    /// + 8*11 (u64 fields) + 8 (created_at) + 128 (reserved).
    pub const MAX_SIZE: usize =
        8 + 1 + (32 * 7) + (4 + 16) + 1 + 1 + 1 + 2 + (8 * 11) + 8 + 128;

    /// Longest accepted ticker. Kept short so it stays a valid PDA seed.
    pub const MAX_TICKER_LEN: usize = 16;

    /// Highest allowed trading spread (5%).
    pub const MAX_FEE_BPS: u16 = 500;

    pub fn require_active(&self) -> Result<()> {
        require!(self.status == MarketStatus::Active, SpotError::MarketNotActive);
        Ok(())
    }

    /// The trading spread on a given USDC notional.
    pub fn fee_on(&self, notional: u64) -> u64 {
        (notional as u128)
            .saturating_mul(self.fee_bps as u128)
            .checked_div(10_000)
            .unwrap_or(0) as u64
    }

    /// USDC notional of `shares` at `price` (price is USDC per whole share,
    /// both quantities carrying `share_decimals`). Widened to u128 so a
    /// large position times a large price cannot overflow mid-calculation.
    pub fn notional(&self, shares: u64, price: u64) -> u64 {
        let scale = 10u128.pow(self.share_decimals as u32);
        (shares as u128)
            .saturating_mul(price as u128)
            .checked_div(scale)
            .unwrap_or(0) as u64
    }

    /// Fees collected but not yet swept — the bound on `sweep_fee`.
    pub fn fees_outstanding(&self) -> u64 {
        self.fees_collected.saturating_sub(self.fees_swept)
    }

    /// USDC in the market account that is NOT spoken for: neither backing a
    /// pending buy escrow nor earned spread awaiting sweep.
    ///
    /// `market_usdc` is a single pooled account holding three different
    /// claims — traders' pending buy escrow, Marco's earned spread, and sale
    /// proceeds returned by the broker. Any payout that is not itself drawn
    /// against escrow must come out of this unreserved slice, or it silently
    /// spends one trader's escrow on another trader's settlement.
    pub fn unreserved_usdc(&self, balance: u64) -> u64 {
        balance
            .saturating_sub(self.usdc_escrowed)
            .saturating_sub(self.fees_outstanding())
    }
}

/// Per-trader eligibility record.
///
/// Keyed by `admin` rather than by market, so a trader is verified once
/// for the whole deployment rather than per security. Marco sets this
/// after off-chain identity verification; the program only reads the flag.
#[account]
pub struct TraderAccount {
    pub bump: u8,

    /// The authority that vouched for this trader.
    pub admin: Pubkey,

    /// The trader's wallet.
    pub trader: Pubkey,

    /// Whether the trader may place orders. Revocable.
    pub eligible: bool,

    /// ISO 3166-1 numeric country code, for jurisdiction gating off-chain.
    /// 0 when unset.
    pub jurisdiction: u16,

    pub registered_at: i64,
    pub updated_at: i64,

    pub _reserved: [u8; 32],
}

impl TraderAccount {
    pub const MAX_SIZE: usize = 8 + 1 + 32 + 32 + 1 + 2 + 8 + 8 + 32;
}

#[account]
pub struct Order {
    pub bump: u8,

    pub market: Pubkey,
    pub trader: Pubkey,

    /// Monotonic id within the market; part of the order PDA seeds.
    pub order_id: u64,

    pub side: OrderSide,
    pub status: OrderStatus,

    /// Buy: USDC escrowed at submission (gross, fee inclusive).
    /// Sell: USDC paid out at settlement (net of fee).
    pub usdc_amount: u64,

    /// Buy: shares minted at fill. Sell: shares escrowed at submission.
    pub shares_amount: u64,

    /// Buy: highest acceptable price per share. Sell: lowest acceptable.
    /// Enforced against the attested execution price.
    pub limit_price: u64,

    /// Buy only: the fewest shares the trader will accept for their capital.
    /// `limit_price` caps what each share may cost but says nothing about
    /// how many arrive, so without this a fill could convert the whole
    /// deployment into a token dust position. Must be non-zero.
    pub min_shares_out: u64,

    /// Spread rate snapshotted when the order was placed, so a later
    /// `set_fee_bps` cannot re-price an order already in flight.
    pub fee_bps: u16,

    /// Attested execution price per share.
    pub execution_price: u64,

    /// Trading spread charged on this order.
    pub fee_paid: u64,

    /// Buy: USDC actually sent to the conversion partner.
    pub deployed_amount: u64,

    /// Custodian's reference for the resulting position.
    pub custody_ref: [u8; 32],

    /// Fingerprint of the broker confirmation + custodian statement. The
    /// documents stay off-chain; publishing only the hash lets a holder
    /// verify a document they are shown is genuine without exposing
    /// counterparty paperwork.
    pub doc_hash: [u8; 32],

    pub created_at: i64,
    pub updated_at: i64,
    pub attested_at: i64,

    pub _reserved: [u8; 54],
}

impl Order {
    /// 8 (disc) + 1 (bump) + 32*2 (pubkeys) + 8 (order_id) + 1 (side)
    /// + 1 (status) + 8*7 (u64 amounts) + 2 (fee_bps) + 32*2 (attestation
    /// hashes) + 8*3 (timestamps) + 54 (reserved).
    /// Total unchanged: `min_shares_out` and `fee_bps` came out of `_reserved`.
    pub const MAX_SIZE: usize =
        8 + 1 + 32 + 32 + 8 + 1 + 1 + (8 * 7) + 2 + 32 + 32 + (8 * 3) + 54;
}

/// Cumulative per-trader record for one market. The position token balance
/// is the live position; this is the running history used for reconciliation
/// against the custodian's statements.
#[account]
pub struct Holding {
    pub bump: u8,

    pub market: Pubkey,
    pub trader: Pubkey,

    pub shares_bought: u64,
    pub shares_sold: u64,
    pub usdc_spent: u64,
    pub usdc_received: u64,
    pub fees_paid: u64,

    pub _reserved: [u8; 32],
}

impl Holding {
    pub const MAX_SIZE: usize = 8 + 1 + 32 + 32 + (8 * 5) + 32;
}
