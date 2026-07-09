use anchor_lang::prelude::*;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Deployed -> Live. Records that the underlying security has listed and
/// is trading, the real share allocation the broker holds, and opens the
/// share-delivery election window. Admin only. No funds move.
///
/// `shares_allocated` fixes the delivery entitlement (a claim token converts
/// to `shares_allocated / total_shares` real shares). `election_period_secs`
/// sets how long holders may elect delivery before the position is sold;
/// pass 0 to open Live with the window already closed (cash-only).
pub fn handler(
    ctx: Context<MarkListed>,
    shares_allocated: u64,
    election_period_secs: i64,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Deployed)?;
    require!(election_period_secs >= 0, VaultError::InvalidParameter);

    let now = Clock::get()?.unix_timestamp;
    vault.shares_allocated = shares_allocated;
    vault.election_deadline = now.saturating_add(election_period_secs);
    vault.phase = VaultPhase::Live;
    msg!(
        "Vault {} live (listed) | allocation {} shares | election until {}",
        vault.vault_id,
        shares_allocated,
        vault.election_deadline
    );
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
