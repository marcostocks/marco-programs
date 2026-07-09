use anchor_lang::prelude::*;

use crate::errors::VaultError;

// ═══════════════════════════════════════════════════════════════
// MARCO VAULT STATE
//
// One vault == one listing event, paired with one off-chain SPV /
// licensed broker. The program handles subscription, claim issuance,
// deployment tracking, settlement and redemption on-chain; the real
// shares are sourced, held and sold off-chain by the custodian.
//
// Security notes:
// - The admin authority is expected to be a Squads multisig (m-of-n).
//   The program treats `admin` as a single authority pubkey; the
//   threshold signing happens in the multisig program, so nothing
//   custom is baked in here.
// - The broker payout address (`deposit_destination`) is fixed at
//   creation and can never be changed — capital can only ever leave
//   the vault to that one account.
// - Share decimals match USDC (6) so 1 claim unit == 1 USDC of
//   subscribed capital.
// ═══════════════════════════════════════════════════════════════

/// The Marco vault lifecycle. Each phase gates a specific set of
/// actions; transitions are driven by admin calls backed by real
/// off-chain events (allocation confirmations, listing, sale, cash
/// return). Naming is Marco's own — the shape follows the economics
/// of a subscription vault, not any one competitor's labels.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum VaultPhase {
    /// Parameters published, subscription not yet open.
    Scheduled,
    /// Subscription window live. USDC accepted up to the cap.
    Funding,
    /// Subscription closed (cap hit or window expired). No more deposits.
    Sealed,
    /// Allocation requested from the source; confirmation pending.
    Sourcing,
    /// Allocation confirmed; the deployable amount is now known.
    Sourced,
    /// Subscribed capital sent to the broker settlement account.
    Deployed,
    /// The underlying security has listed / is trading.
    Live,
    /// The position has been sold; gross proceeds reported.
    Realized,
    /// Net cash returned on-chain; claims (redemption) are open.
    Claimable,
    /// Bulk of claims processed; residual window before close-out.
    Winding,
    /// Close-out date passed. Terminal — no further claims.
    Concluded,
    /// Deal aborted before deployment; refunds enabled.
    Cancelled,
    /// All refunds processed. Terminal.
    Refunded,
}

impl Default for VaultPhase {
    fn default() -> Self {
        VaultPhase::Scheduled
    }
}

#[account]
pub struct Vault {
    /// PDA bump.
    pub bump: u8,

    /// Controlling authority — expected to be a Squads multisig PDA.
    pub admin: Pubkey,

    /// Operator wallet — may trigger capital deployment (can equal admin).
    pub operator: Pubkey,

    /// Treasury wallet — receives the protocol fee.
    pub treasury: Pubkey,

    /// IMMUTABLE broker / SPV USDC account. Deployed capital can only
    /// ever be sent here. Set once at creation, never mutated.
    pub deposit_destination: Pubkey,

    /// SPL mint for the vault claim token.
    pub share_mint: Pubkey,

    /// The vault's own USDC token account.
    pub vault_usdc: Pubkey,

    /// Human-readable id, e.g. "hkex-sdmc-2026-q3".
    pub vault_id: String,

    /// Current lifecycle phase.
    pub phase: VaultPhase,

    /// Whether deposits are frozen (emergency control).
    pub frozen: bool,

    /// Maximum USDC the vault will accept (6 decimals).
    pub deposit_cap: u64,

    /// Minimum USDC a single deposit must intend (anti-dust).
    pub min_deposit: u64,

    /// Maximum cumulative USDC per address (0 = no per-address cap).
    pub max_deposit: u64,

    /// Unix ts the subscription window opens.
    pub funding_start: i64,

    /// Unix ts after which deposits are rejected.
    pub funding_deadline: i64,

    /// Unix ts after which Claimable/Winding can be Concluded.
    pub close_out_at: i64,

    /// Total USDC subscribed.
    pub total_deposits: u64,

    /// Total claim tokens minted (== total_deposits while funding).
    pub total_shares: u64,

    /// Confirmed deployable amount (set at allocation confirmation).
    pub deployable_amount: u64,

    /// Subscribed capital NOT deployed (refundable remainder).
    pub undeployed_amount: u64,

    /// Total USDC actually sent to the broker destination.
    pub total_deployed: u64,

    /// Gross sale proceeds reported at Realized (informational).
    pub gross_proceeds: u64,

    /// Net USDC returned by the broker after the sale.
    pub settlement_amount: u64,

    /// USDC available to claimants (settlement balance minus fee).
    pub redeemable_amount: u64,

    /// Claim tokens redeemed so far.
    pub total_redeemed_shares: u64,

    /// USDC paid out in redemptions so far.
    pub total_redeemed_usdc: u64,

    /// Protocol fee in basis points (500 = 5.00%). Marco's single
    /// on-chain take. There is NO separate upside/performance fee.
    pub fee_bps: u16,

    /// Protocol fee computed at settlement.
    pub fees_collected: u64,

    /// Protocol fee swept to treasury.
    pub fees_swept: u64,

    /// Disclosed unrefundable costs deducted from refunds on cancel.
    pub unrefundable_costs: u64,

    /// USDC returned to depositors during a cancellation refund.
    pub total_refunded_usdc: u64,

    /// Reserved for forward-compatible upgrades.
    pub _reserved: [u8; 128],
}

impl Vault {
    /// Allocated account size.
    /// 8 (disc) + 1 (bump) + 32*6 (pubkeys) + 4+64 (vault_id) + 1 (phase)
    /// + 1 (frozen) + 8*20 (u64/i64 fields) + 2 (fee_bps) + 128 (reserved).
    pub const MAX_SIZE: usize =
        8 + 1 + (32 * 6) + (4 + 64) + 1 + 1 + (8 * 20) + 2 + 128;

    /// Highest allowed protocol fee (20%).
    pub const MAX_FEE_BPS: u16 = 2000;

    pub fn require_phase(&self, expected: VaultPhase) -> Result<()> {
        require!(self.phase == expected, VaultError::InvalidPhase);
        Ok(())
    }

    /// The protocol fee — a flat `fee_bps` of the net settlement amount,
    /// taken once when the vault settles. Flat, not upside-contingent.
    pub fn protocol_fee(&self) -> u64 {
        (self.settlement_amount as u128)
            .saturating_mul(self.fee_bps as u128)
            .checked_div(10_000)
            .unwrap_or(0) as u64
    }

    /// Pro-rata USDC owed for a given number of claim tokens at redemption.
    pub fn redeem_amount(&self, shares: u64) -> u64 {
        if self.total_shares == 0 || self.redeemable_amount == 0 {
            return 0;
        }
        (self.redeemable_amount as u128)
            .saturating_mul(shares as u128)
            .checked_div(self.total_shares as u128)
            .unwrap_or(0) as u64
    }

    /// Pro-rata USDC owed for a given number of claim tokens on a cancelled
    /// vault. Returns principal less the depositor's share of unrefundable
    /// costs: (total_deposits - unrefundable_costs) * shares / total_shares.
    pub fn refund_amount(&self, shares: u64) -> u64 {
        if self.total_shares == 0 {
            return 0;
        }
        let pool = self.total_deposits.saturating_sub(self.unrefundable_costs);
        (pool as u128)
            .saturating_mul(shares as u128)
            .checked_div(self.total_shares as u128)
            .unwrap_or(0) as u64
    }
}

#[account]
pub struct BuyerState {
    /// PDA bump.
    pub bump: u8,

    /// The vault this record belongs to.
    pub vault: Pubkey,

    /// The depositor wallet.
    pub depositor: Pubkey,

    /// Cumulative USDC subscribed by this address.
    pub deposit_amount: u64,

    /// Cumulative claim tokens minted to this address.
    pub shares_minted: u64,

    /// Claim tokens redeemed by this address.
    pub shares_redeemed: u64,

    /// USDC received from redemptions.
    pub usdc_redeemed: u64,

    /// USDC received from cancellation refunds.
    pub usdc_refunded: u64,

    /// Reserved for forward-compatible upgrades.
    pub _reserved: [u8; 56],
}

impl BuyerState {
    pub const MAX_SIZE: usize = 8 + 1 + 32 + 32 + (8 * 5) + 56;
}
