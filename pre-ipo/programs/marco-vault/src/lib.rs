use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use state::VaultPhase;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// Marco Pre-IPO Subscription Vaults.
///
/// One vault per listing event. USDC is subscribed during a funding
/// window, deployed to a licensed broker, and — after the shares list
/// and sell — net proceeds return on-chain for pro-rata redemption.
/// A single flat protocol fee (default 5%) is taken at settlement.
#[program]
pub mod marco_vault {
    use super::*;

    /// Create a vault. PDA seeds: [b"vault", admin, vault_id].
    /// `deposit_destination` (the broker USDC account) is fixed here forever.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize_vault(
        ctx: Context<instructions::initialize::InitializeVault>,
        params: instructions::initialize::VaultParams,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Scheduled -> Funding. Opens the subscription window.
    pub fn open_funding(ctx: Context<instructions::open_funding::OpenFunding>) -> Result<()> {
        instructions::open_funding::handler(ctx)
    }

    /// Subscribe USDC. Partial-fill up to the cap and the per-address
    /// limit; unfilled USDC never leaves the depositor's wallet. Mints
    /// claim tokens 1:1 with accepted USDC.
    pub fn deposit(ctx: Context<instructions::deposit::Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Funding -> Sealed. Closes the subscription window (deadline or manual).
    pub fn seal_funding(ctx: Context<instructions::seal_funding::SealFunding>) -> Result<()> {
        instructions::seal_funding::handler(ctx)
    }

    /// Sealed -> Sourcing. Marks the allocation as requested/pending.
    pub fn begin_sourcing(
        ctx: Context<instructions::begin_sourcing::BeginSourcing>,
    ) -> Result<()> {
        instructions::begin_sourcing::handler(ctx)
    }

    /// Sourcing -> Sourced. Records the confirmed deployable allocation;
    /// the remainder becomes refundable at redemption.
    pub fn confirm_allocation(
        ctx: Context<instructions::confirm_allocation::ConfirmAllocation>,
        deployable_amount: u64,
    ) -> Result<()> {
        instructions::confirm_allocation::handler(ctx, deployable_amount)
    }

    /// Sourced -> Deployed (partial deploys allowed). Sends USDC to the
    /// immutable broker destination, capped to the confirmed allocation.
    pub fn deploy_capital(
        ctx: Context<instructions::deploy_capital::DeployCapital>,
        amount: u64,
    ) -> Result<()> {
        instructions::deploy_capital::handler(ctx, amount)
    }

    /// Deployed -> Live. Records that the security has listed.
    pub fn mark_listed(ctx: Context<instructions::mark_listed::MarkListed>) -> Result<()> {
        instructions::mark_listed::handler(ctx)
    }

    /// Live -> Realized. Records gross sale proceeds (informational).
    pub fn mark_realized(
        ctx: Context<instructions::mark_realized::MarkRealized>,
        gross_proceeds: u64,
    ) -> Result<()> {
        instructions::mark_realized::handler(ctx, gross_proceeds)
    }

    /// Realized -> Claimable. Records net USDC returned, computes the flat
    /// fee, and sets the redeemable balance. Opens redemption.
    pub fn settle(ctx: Context<instructions::settle::Settle>, net_amount: u64) -> Result<()> {
        instructions::settle::handler(ctx, net_amount)
    }

    /// Burn claim tokens, receive pro-rata USDC. Allowed in Claimable/Winding.
    pub fn claim(ctx: Context<instructions::claim::Claim>, shares_amount: u64) -> Result<()> {
        instructions::claim::handler(ctx, shares_amount)
    }

    /// Claimable -> Winding. Marks the bulk-redeemed residual window.
    pub fn wind_down(ctx: Context<instructions::wind_down::WindDown>) -> Result<()> {
        instructions::wind_down::handler(ctx)
    }

    /// Winding/Claimable -> Concluded. Only after the close-out date. Terminal.
    pub fn conclude(ctx: Context<instructions::wind_down::WindDown>) -> Result<()> {
        instructions::wind_down::conclude(ctx)
    }

    /// Abort a pre-deployment vault: * -> Cancelled. Enables refunds and
    /// records disclosed unrefundable costs.
    pub fn cancel_vault(
        ctx: Context<instructions::cancel::CancelVault>,
        unrefundable_costs: u64,
    ) -> Result<()> {
        instructions::cancel::handler(ctx, unrefundable_costs)
    }

    /// Refund a cancelled vault: burn claim tokens, receive principal less
    /// pro-rata unrefundable costs.
    pub fn refund(ctx: Context<instructions::refund::Refund>, shares_amount: u64) -> Result<()> {
        instructions::refund::handler(ctx, shares_amount)
    }

    /// Sweep collected protocol fees to the treasury. Bounded by fees_collected.
    pub fn sweep_fee(ctx: Context<instructions::sweep_fee::SweepFee>, amount: u64) -> Result<()> {
        instructions::sweep_fee::handler(ctx, amount)
    }

    /// Freeze or unfreeze deposits. Admin only.
    pub fn freeze_deposits(
        ctx: Context<instructions::admin::AdminAction>,
        frozen: bool,
    ) -> Result<()> {
        instructions::admin::freeze_deposits(ctx, frozen)
    }

    /// Rotate the operator wallet. Admin only.
    pub fn update_operator(
        ctx: Context<instructions::admin::AdminAction>,
        new_operator: Pubkey,
    ) -> Result<()> {
        instructions::admin::update_operator(ctx, new_operator)
    }
}

/// Shared helper: is this phase one where deposits are accepted?
pub fn is_funding(phase: VaultPhase) -> bool {
    phase == VaultPhase::Funding
}
