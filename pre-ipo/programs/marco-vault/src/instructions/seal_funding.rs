use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Funding -> Sealed. Closes subscription. Admin only.
/// The cap path auto-seals in `deposit`; this handles the deadline path
/// or a discretionary early close.
pub fn handler(ctx: Context<SealFunding>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Funding)?;

    vault.phase = VaultPhase::Sealed;
    msg!("Vault {} sealed | subscribed {}", vault.vault_id, vault.total_deposits);
    Ok(())
}

#[derive(Accounts)]
pub struct SealFunding<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
