use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Scheduled -> Funding. Opens the subscription window. Admin only.
/// Rejected before `funding_start` so the published schedule is honored.
pub fn handler(ctx: Context<OpenFunding>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Scheduled)?;

    let now = Clock::get()?.unix_timestamp;
    require!(now >= vault.funding_start, VaultError::FundingNotStarted);

    vault.phase = VaultPhase::Funding;
    msg!("Vault {} funding open", vault.vault_id);
    Ok(())
}

#[derive(Accounts)]
pub struct OpenFunding<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
