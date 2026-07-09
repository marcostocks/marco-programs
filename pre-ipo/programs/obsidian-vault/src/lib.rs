use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

declare_id!("ObsVAULT111111111111111111111111111111111111");

#[program]
pub mod obsidian_vault {
    use super::*;

    /// Initialize a new IPO subscription vault.
    /// PDA: [b"vault", admin, vault_id]
    pub fn initialize_vault(
        ctx: Context<instructions::initialize::InitializeVault>,
        vault_id: String,
        deposit_cap: u64,
        deposit_deadline: i64,
        sourcing_spread_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            vault_id,
            deposit_cap,
            deposit_deadline,
            sourcing_spread_bps,
        )
    }

    /// Deposit USDC into an open vault. Mints 1:1 share tokens.
    pub fn deposit(ctx: Context<instructions::deposit::Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Close the funding window. Admin only.
    pub fn close_funding(
        ctx: Context<instructions::close_funding::CloseFunding>,
    ) -> Result<()> {
        instructions::close_funding::handler(ctx)
    }

    /// Move USDC to broker for IPO subscription. Admin/operator only.
    pub fn move_assets(
        ctx: Context<instructions::move_assets::MoveAssets>,
        amount: u64,
    ) -> Result<()> {
        instructions::move_assets::handler(ctx, amount)
    }

    /// Record settlement amount after broker returns proceeds. Admin only.
    pub fn record_settlement(
        ctx: Context<instructions::record_settlement::RecordSettlement>,
        usdc_amount: u64,
    ) -> Result<()> {
        instructions::record_settlement::handler(ctx, usdc_amount)
    }

    /// Open redemption window. Admin only. Sets redeemable to vault balance minus fees.
    pub fn open_redemption(
        ctx: Context<instructions::open_redemption::OpenRedemption>,
    ) -> Result<()> {
        instructions::open_redemption::handler(ctx)
    }

    /// Burn shares and receive pro-rata USDC proceeds.
    pub fn redeem(
        ctx: Context<instructions::redeem::Redeem>,
        shares_amount: u64,
    ) -> Result<()> {
        instructions::redeem::handler(ctx, shares_amount)
    }

    /// Sweep accumulated fees to treasury. Admin only.
    pub fn sweep_fee(
        ctx: Context<instructions::sweep_fee::SweepFee>,
        amount: u64,
    ) -> Result<()> {
        instructions::sweep_fee::handler(ctx, amount)
    }

    /// Freeze or unfreeze deposits. Admin only.
    pub fn freeze_deposits(
        ctx: Context<instructions::admin::AdminAction>,
        frozen: bool,
    ) -> Result<()> {
        instructions::admin::freeze_deposits(ctx, frozen)
    }

    /// Update the operator wallet. Admin only.
    pub fn update_operator(
        ctx: Context<instructions::admin::AdminAction>,
        new_operator: Pubkey,
    ) -> Result<()> {
        instructions::admin::update_operator(ctx, new_operator)
    }
}
