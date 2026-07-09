use anchor_lang::prelude::*;

use crate::state::Vault;
use crate::errors::VaultError;

/// Freeze or unfreeze deposits (emergency control).
pub fn freeze_deposits(ctx: Context<AdminAction>, frozen: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.frozen = frozen;

    msg!(
        "Vault {} deposits {}",
        vault.vault_id,
        if frozen { "FROZEN" } else { "UNFROZEN" }
    );

    Ok(())
}

/// Update the operator wallet.
pub fn update_operator(ctx: Context<AdminAction>, new_operator: Pubkey) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.operator = new_operator;

    msg!("Operator updated to {}", new_operator);

    Ok(())
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
