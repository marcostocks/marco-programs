use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Sealed -> Sourcing. Marks that the allocation has been requested from
/// the source and confirmation is pending. Admin only. No funds move.
pub fn handler(ctx: Context<BeginSourcing>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Sealed)?;

    vault.phase = VaultPhase::Sourcing;
    msg!("Vault {} sourcing allocation", vault.vault_id);
    Ok(())
}

#[derive(Accounts)]
pub struct BeginSourcing<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
