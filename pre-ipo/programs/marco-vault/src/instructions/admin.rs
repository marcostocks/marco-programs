use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Extend or adjust the subscription window's deadline. Admin only, and only
/// while the vault is still in Funding — this lengthens an open window, it does
/// not revive a sealed or settled one. The new deadline must be in the future;
/// to close a window early use `seal_funding` rather than a past timestamp.
pub fn set_funding_deadline(ctx: Context<AdminAction>, new_deadline: i64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Funding)?;
    let now = Clock::get()?.unix_timestamp;
    require!(new_deadline > now, VaultError::DeadlineInPast);
    vault.funding_deadline = new_deadline;
    msg!("Vault {} funding deadline set to {}", vault.vault_id, new_deadline);
    Ok(())
}

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

/// Choose when the protocol fee is charged. Admin only, and only before any
/// deposit has been taken — the token model (net vs gross) has to be fixed
/// before the first depositor mints against it, or holders would be minted on
/// inconsistent terms.
///
/// `false` (the default) is the original entry-fee behaviour: the fee comes off
/// each deposit and claim tokens are the net. `true` mints tokens 1:1 against
/// the gross deposit and defers the fee to redemption. Existing vaults created
/// before this instruction existed read `false` and are unaffected.
pub fn set_fee_timing(ctx: Context<AdminAction>, fee_at_exit: bool) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(vault.total_shares == 0, VaultError::FeeTimingLocked);
    vault.fee_at_exit = fee_at_exit;
    msg!(
        "Vault {} fee charged at {}",
        vault.vault_id,
        if fee_at_exit { "REDEMPTION (mint gross)" } else { "DEPOSIT (mint net)" }
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
