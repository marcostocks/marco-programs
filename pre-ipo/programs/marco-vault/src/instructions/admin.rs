use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::Vault;

/// Freeze or unfreeze deposits (emergency control). Admin only.
pub fn freeze_deposits(ctx: Context<AdminAction>, frozen: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.frozen = frozen;
    msg!("Vault {} deposits {}", vault.vault_id, if frozen { "FROZEN" } else { "UNFROZEN" });
    Ok(())
}

/// Lock or unlock claim tokens in holders' wallets. Admin only.
///
/// While locked (the default from creation), every claim-token account is
/// frozen on mint, so tokens can only be burned back to the vault and never
/// transferred or sold on.
///
/// SPL freezes are per-account and cannot be applied or cleared mint-wide, so
/// this flag governs future freezes only — it never rewrites existing accounts:
///
/// - Setting it false stops new freezes but does not thaw already-frozen
///   accounts. Each one still needs an `unlock_shares` call, which this flag
///   is the precondition for.
/// - Setting it true again does not retroactively re-freeze accounts that were
///   already thawed. They are re-locked the next time they pass through
///   deposit/claim/refund/elect_delivery, and are transferable until then.
///
/// Treat unlocking as effectively one-way: once holders are thawed, re-locking
/// them is not something this instruction can guarantee on its own.
pub fn set_transfer_lock(ctx: Context<AdminAction>, locked: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.transfer_lock = locked;
    msg!(
        "Vault {} claim tokens {}",
        vault.vault_id,
        if locked { "LOCKED" } else { "UNLOCKED (holders must call unlock_shares)" }
    );
    Ok(())
}

/// Rotate the operator wallet. Admin only.
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
