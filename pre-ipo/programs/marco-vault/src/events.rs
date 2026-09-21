use anchor_lang::prelude::*;

/// Events for the four holder-initiated instructions.
///
/// These exist for the off-chain orchestrator, which creates every intent from
/// an observed chain event and never from an HTTP call — the on-chain escrow
/// *is* the authorisation. Without a structured event the watcher would have to
/// decode raw instruction data and re-read account state to learn what
/// happened, which is both fragile and racy.
///
/// Admin transitions are deliberately not emitted. The operator submits those
/// itself, so it already knows they happened; only holder actions arrive
/// unannounced.
///
/// Each event carries `vault_id` alongside the vault pubkey. The orchestrator
/// keys deals by that string, and including it saves an account read per event
/// on a hot polling path.

/// A holder subscribed USDC and received claim tokens.
///
/// `accepted` is gross (what the cap counts), `subscribed` is net of the
/// upfront fee and equals the claim tokens minted. They differ, and conflating
/// them mis-states the cap.
#[event]
pub struct DepositMade {
    pub vault: Pubkey,
    pub vault_id: String,
    pub depositor: Pubkey,
    /// What the depositor asked for, before cap and per-address clamping.
    pub intent: u64,
    /// Gross USDC actually pulled from the wallet.
    pub accepted: u64,
    /// Upfront protocol fee taken from the gross.
    pub fee: u64,
    /// Net subscribed — claim tokens minted, 1:1.
    pub subscribed: u64,
    pub total_deposits: u64,
    /// True when this deposit hit the cap and auto-sealed the vault.
    pub auto_sealed: bool,
}

/// A holder burned claim tokens for their pro-rata USDC.
#[event]
pub struct ClaimMade {
    pub vault: Pubkey,
    pub vault_id: String,
    pub claimant: Pubkey,
    pub shares_burned: u64,
    pub usdc_paid: u64,
}

/// A holder burned claim tokens on a cancelled vault for principal less the
/// pro-rata share of disclosed unrefundable costs.
#[event]
pub struct RefundMade {
    pub vault: Pubkey,
    pub vault_id: String,
    pub holder: Pubkey,
    pub shares_burned: u64,
    pub usdc_paid: u64,
}

/// A holder elected real shares over a cash redemption. The broker delivers
/// `underlying_shares` off-chain and reconciles against
/// `buyer_state.underlying_delivered`.
#[event]
pub struct DeliveryElected {
    pub vault: Pubkey,
    pub vault_id: String,
    pub holder: Pubkey,
    pub shares_burned: u64,
    pub underlying_shares: u64,
}
