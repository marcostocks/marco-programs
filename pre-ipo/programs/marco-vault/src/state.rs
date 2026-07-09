use anchor_lang::prelude::*;

// ═══════════════════════════════════════════════════════════════
// VAULT STATE — Core state machine for IPO subscription vaults
//
// Security: Admin pubkey in PDA seeds prevents front-running (H-1).
// Share decimals match USDC (6) to avoid display errors (L-3).
// ═══════════════════════════════════════════════════════════════

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum VaultPhase {
    /// Deposits accepted. Users send USDC, receive share tokens.
    FundingOpen,
    /// Deposit window closed (deadline passed or cap hit). No more deposits.
    FundingClosed,
    /// USDC sent to broker for IPO subscription. Waiting for settlement.
    AssetsDeployed,
    /// Broker returned proceeds. Settlement amount recorded on-chain.
    Settled,
    /// Users can burn shares and redeem pro-rata USDC proceeds.
    RedemptionOpen,
}

impl Default for VaultPhase {
    fn default() -> Self {
        VaultPhase::FundingOpen
    }
}

#[account]
pub struct Vault {
    /// Bump seed for PDA derivation
    pub bump: u8,

    /// Admin wallet — controls vault lifecycle transitions
    pub admin: Pubkey,

    /// Operator wallet — can move assets to broker (may equal admin)
    pub operator: Pubkey,

    /// Treasury wallet — receives management + performance fees
    pub treasury: Pubkey,

    /// Human-readable vault identifier (e.g., "sdmc-ipo-may-2026")
    pub vault_id: String,

    /// Current phase of the vault state machine
    pub phase: VaultPhase,

    /// Maximum USDC the vault accepts (in USDC lamports, 6 decimals)
    pub deposit_cap: u64,

    /// Unix timestamp after which deposits are rejected
    pub deposit_deadline: i64,

    /// Total USDC deposited into the vault
    pub total_deposits: u64,

    /// Total share tokens minted (should equal total_deposits in FundingOpen)
    pub total_shares: u64,

    /// USDC returned by broker after IPO settlement
    pub settlement_amount: u64,

    /// Amount available for redemption (settlement minus fees)
    pub redeemable_amount: u64,

    /// Total shares redeemed so far
    pub total_redeemed_shares: u64,

    /// Total USDC paid out in redemptions so far
    pub total_redeemed_usdc: u64,

    /// Sourcing spread in basis points — Marco's margin on filling pre-IPO
    /// shares against confirmed vault demand (e.g., 150 = 1.50%).
    ///
    /// This is the ONLY protocol fee taken inside the vault. The market-making
    /// spread is earned on the trading venue (bid-ask on each fill) and the
    /// custody margin is billed by the regulated custodian — neither is charged
    /// on-chain here.
    pub sourcing_spread_bps: u16,

    /// Total sourcing-spread fees collected at settlement
    pub fees_collected: u64,

    /// Total fees swept to treasury
    pub fees_swept: u64,

    /// SPL token mint for vault share tokens
    pub share_mint: Pubkey,

    /// Vault's USDC token account (ATA)
    pub vault_usdc: Pubkey,

    /// Total USDC moved to broker via move_assets
    pub total_moved: u64,

    /// Whether deposits are frozen (admin emergency control)
    pub frozen: bool,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 128],
}

impl Vault {
    /// Account size for rent calculation.
    /// 8 (discriminator) + 1 (bump) + 32*5 (pubkeys) + 4+64 (vault_id string)
    /// + 1 (phase) + 8*11 (ten u64s + one i64 deadline) + 2 (u16 spread) + 1 (frozen)
    /// + 128 (reserved).
    /// NOTE: previously used 8*9, which under-allocated by 16 bytes and would fail
    /// to serialize for vault_ids longer than ~48 chars (the cap is 64).
    pub const MAX_SIZE: usize = 8 + 1 + (32 * 5) + (4 + 64) + 1 + (8 * 11) + 2 + 1 + 128;

    /// Check if vault is in the expected phase
    pub fn require_phase(&self, expected: VaultPhase) -> Result<()> {
        require!(
            self.phase == expected,
            VaultError::InvalidPhase
        );
        Ok(())
    }

    /// Sourcing-spread fee — flat bps of the settlement amount, taken once at
    /// settlement. Represents Marco's margin on sourcing the pre-IPO shares.
    pub fn sourcing_fee(&self) -> u64 {
        (self.settlement_amount as u128)
            .checked_mul(self.sourcing_spread_bps as u128)
            .unwrap_or(0)
            .checked_div(10_000)
            .unwrap_or(0) as u64
    }

    /// Total protocol fees taken in the vault (sourcing spread only).
    pub fn total_fees(&self) -> u64 {
        self.sourcing_fee()
    }

    /// Calculate pro-rata USDC for a given number of shares
    pub fn redeem_amount(&self, shares: u64) -> u64 {
        if self.total_shares == 0 || self.redeemable_amount == 0 {
            return 0;
        }
        // Use u128 to prevent overflow on large amounts
        (self.redeemable_amount as u128)
            .checked_mul(shares as u128)
            .unwrap_or(0)
            .checked_div(self.total_shares as u128)
            .unwrap_or(0) as u64
    }
}

#[account]
pub struct BuyerState {
    /// Bump seed for PDA derivation
    pub bump: u8,

    /// The vault this buyer state belongs to
    pub vault: Pubkey,

    /// The depositor's wallet address
    pub depositor: Pubkey,

    /// Total USDC deposited by this user
    pub deposit_amount: u64,

    /// Total share tokens minted to this user
    pub shares_minted: u64,

    /// Total shares redeemed by this user
    pub shares_redeemed: u64,

    /// Total USDC received from redemptions
    pub usdc_redeemed: u64,

    /// Reserved space for future upgrades
    pub _reserved: [u8; 64],
}

impl BuyerState {
    pub const MAX_SIZE: usize = 8 + 1 + 32 + 32 + 8 + 8 + 8 + 8 + 64;
}

use crate::errors::VaultError;
