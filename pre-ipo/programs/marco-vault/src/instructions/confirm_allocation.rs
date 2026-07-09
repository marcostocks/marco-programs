use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Sourcing -> Sourced. Records the confirmed deployable allocation.
/// The difference between subscribed capital and the deployable amount
/// is the undeployed remainder, which stays in the vault and returns to
/// depositors pro-rata at redemption. Admin only.
pub fn handler(ctx: Context<ConfirmAllocation>, deployable_amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Sourcing)?;

    require!(
        deployable_amount <= vault.total_deposits,
        VaultError::AllocationExceedsDeposits
    );

    vault.deployable_amount = deployable_amount;
    vault.undeployed_amount = vault.total_deposits.saturating_sub(deployable_amount);
    vault.phase = VaultPhase::Sourced;

    msg!(
        "Allocation confirmed | deployable {} | undeployed {} (refundable at redemption)",
        vault.deployable_amount,
        vault.undeployed_amount
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ConfirmAllocation<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
