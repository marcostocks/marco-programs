use anchor_lang::prelude::*;

use crate::state::{Vault, VaultPhase};
use crate::errors::VaultError;

/// Record the settlement amount after broker returns IPO proceeds.
/// Transitions AssetsDeployed → Settled.
///
/// Admin calls this after USDC has been returned to the vault_usdc account.
/// The settlement_amount is the total USDC returned by the broker.
pub fn handler(ctx: Context<RecordSettlement>, usdc_amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::AssetsDeployed)?;

    require!(usdc_amount > 0, VaultError::ZeroSettlement);

    vault.settlement_amount = usdc_amount;
    vault.phase = VaultPhase::Settled;

    // Calculate and record fees
    vault.fees_collected = vault.total_fees();

    msg!(
        "Settlement recorded: {} USDC returned | Deposits: {} | Fees: {} | Net return: {}%",
        usdc_amount,
        vault.total_deposits,
        vault.fees_collected,
        if vault.total_deposits > 0 {
            ((usdc_amount as i128 - vault.total_deposits as i128) * 10000 / vault.total_deposits as i128) as i64
        } else {
            0
        }
    );

    Ok(())
}

#[derive(Accounts)]
pub struct RecordSettlement<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub admin: Signer<'info>,
}
