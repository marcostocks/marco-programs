use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Claimable -> Winding. Signals the bulk of claims are processed and the
/// vault is in its residual window. Claims stay open. Admin only.
pub fn handler(ctx: Context<WindDown>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Claimable)?;

    vault.phase = VaultPhase::Winding;
    msg!("Vault {} winding down | redeemed {}/{}", vault.vault_id, vault.total_redeemed_shares, vault.total_shares);
    Ok(())
}

/// Claimable/Winding -> Concluded. Terminal. Only after `close_out_at`.
/// Blocks any further claims. Admin only.
pub fn conclude(ctx: Context<WindDown>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.phase == VaultPhase::Claimable || vault.phase == VaultPhase::Winding,
        VaultError::InvalidPhase
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now >= vault.close_out_at, VaultError::CloseOutNotReached);

    vault.phase = VaultPhase::Concluded;
    msg!("Vault {} concluded", vault.vault_id);
    Ok(())
}

#[derive(Accounts)]
pub struct WindDown<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
