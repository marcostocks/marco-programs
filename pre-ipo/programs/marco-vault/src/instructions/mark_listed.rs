use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Deployed -> Live. Records that the underlying security has listed and
/// is trading. Admin only. No funds move.
pub fn handler(ctx: Context<MarkListed>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Deployed)?;

    vault.phase = VaultPhase::Live;
    msg!("Vault {} live (listed)", vault.vault_id);
    Ok(())
}

#[derive(Accounts)]
pub struct MarkListed<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
