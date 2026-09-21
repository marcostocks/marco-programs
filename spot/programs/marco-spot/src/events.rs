use anchor_lang::prelude::*;

/// Events for the four trader-initiated instructions.
///
/// These exist for the off-chain orchestrator, which creates every intent from
/// an observed chain event and never from an HTTP call — the on-chain escrow
/// *is* the authorisation. A trader whose USDC is not locked in the market
/// escrow has not agreed to anything, so the escrow event is the only thing
/// that may start work on their behalf.
///
/// Operator transitions (`deploy_buy`, `confirm_buy`, `settle_sell`) are
/// deliberately not emitted. The operator submits those itself and already
/// knows the outcome; only trader actions arrive unannounced.
///
/// Each event carries `ticker` alongside the market pubkey. The orchestrator
/// keys markets by that string, and including it saves an account read per
/// event on a hot polling path.

/// A trader escrowed USDC and opened a buy.
#[event]
pub struct BuyPlaced {
    pub market: Pubkey,
    pub ticker: String,
    pub order_id: u64,
    pub trader: Pubkey,
    /// USDC moved into the market escrow.
    pub usdc_amount: u64,
    /// Per-share limit the trader agreed to. A fill may never be attested
    /// worse than this.
    pub limit_price: u64,
    pub min_shares_out: u64,
    /// Spread snapshotted at placement — a later `set_fee_bps` must not
    /// re-price an order already in flight.
    pub fee_bps: u16,
}

/// A trader escrowed position tokens and opened a sell.
///
/// The tokens are escrowed, not burned: while the broker is selling, the
/// custodian still holds the share, so supply should still reflect it.
#[event]
pub struct SellPlaced {
    pub market: Pubkey,
    pub ticker: String,
    pub order_id: u64,
    pub trader: Pubkey,
    pub shares: u64,
    pub limit_price: u64,
    pub fee_bps: u16,
}

/// A buy was cancelled and the stablecoins returned. Cancelled while Pending
/// refunds in full; cancelled while Deployed also reverses the spread.
#[event]
pub struct BuyCancelled {
    pub market: Pubkey,
    pub ticker: String,
    pub order_id: u64,
    pub trader: Pubkey,
    pub usdc_refunded: u64,
    /// True when the cancel asserted a failed off-chain leg (admin only).
    pub was_deployed: bool,
}

/// A pending sell was cancelled and the escrowed position returned intact.
#[event]
pub struct SellCancelled {
    pub market: Pubkey,
    pub ticker: String,
    pub order_id: u64,
    pub trader: Pubkey,
    pub shares_returned: u64,
}
