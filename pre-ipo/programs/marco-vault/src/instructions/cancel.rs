use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Abort a vault before any capital is deployed: * -> Cancelled.
/// Allowed from Scheduled, Funding, Sealed, Sourcing or Sourced — every
/// phase in which subscribed USDC still sits in the vault.
///
/// `unrefundable_costs` is the disclosed, already-incurred cost (e.g. legal
/// or SPV setup) that will be netted out of refunds pro-rata. Must not
/// exceed subscribed capital. Admin only.
pub fn handler(ctx: Context<CancelVault>, unrefundable_costs: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(
        matches!(
            vault.phase,
            VaultPhase::Scheduled
                | VaultPhase::Funding
                | VaultPhase::Sealed
                | VaultPhase::Sourcing
                | VaultPhase::Sourced
        ),
        VaultError::InvalidPhase
    );
    require!(
        unrefundable_costs <= vault.total_deposits,
        VaultError::UnrefundableExceedsDeposits
    );

    vault.unrefundable_costs = unrefundable_costs;
    vault.phase = VaultPhase::Cancelled;

    msg!(
        "Vault {} cancelled | subscribed {} | unrefundable {}",
        vault.vault_id,
        vault.total_deposits,
        unrefundable_costs
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CancelVault<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
