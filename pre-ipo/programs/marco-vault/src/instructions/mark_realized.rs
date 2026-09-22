use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Live -> Realized. Records gross sale proceeds reported by the broker.
/// Informational only — the redeemable figure is fixed later at `settle`
/// from the actual net cash returned. Admin only.
///
/// Blocked until the share-delivery election window has closed, so no one
/// can elect delivery of a position that has already been sold.
pub fn handler(ctx: Context<MarkRealized>, gross_proceeds: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Live)?;

    let now = Clock::get()?.unix_timestamp;
    require!(now >= vault.election_deadline, VaultError::ElectionStillOpen);

    vault.gross_proceeds = gross_proceeds;
    vault.phase = VaultPhase::Realized;
    msg!("Vault {} realized | gross proceeds {}", vault.vault_id, gross_proceeds);
    Ok(())
}

#[derive(Accounts)]
pub struct MarkRealized<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
