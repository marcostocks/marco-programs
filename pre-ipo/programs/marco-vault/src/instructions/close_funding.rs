use anchor_lang::prelude::*;

use crate::state::{Vault, VaultPhase};
use crate::errors::VaultError;

/// Close the funding window. Transitions FundingOpen → FundingClosed.
/// Only admin can call this. Also triggered automatically when cap is hit.
pub fn handler(ctx: Context<CloseFunding>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::FundingOpen)?;

    vault.phase = VaultPhase::FundingClosed;

    msg!(
        "Funding closed: {} | Total deposits: {} USDC",
        vault.vault_id,
        vault.total_deposits
    );

    Ok(())
}

#[derive(Accounts)]
pub struct CloseFunding<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
