use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::state::{Vault, VaultPhase};
use crate::errors::VaultError;

/// Open the redemption window. Transitions Settled → RedemptionOpen.
///
/// Security (Polynomial H-2): redeemable_amount is set to the full vault USDC balance
/// minus fees, ensuring no excess USDC gets stuck after all redemptions.
///
/// Security (Polynomial M-3): No yield sweep functions allowed after this point.
pub fn handler(ctx: Context<OpenRedemption>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Settled)?;

    // Security (H-2): Set redeemable to full available balance minus fees
    // This ensures excess USDC (from rounding, yield, etc.) is redeemable
    let vault_balance = ctx.accounts.vault_usdc.amount;
    let fees = vault.fees_collected.saturating_sub(vault.fees_swept);

    let redeemable = vault_balance.saturating_sub(fees);
    require!(redeemable > 0, VaultError::NoRedeemableAmount);

    vault.redeemable_amount = redeemable;
    vault.phase = VaultPhase::RedemptionOpen;

    msg!(
        "Redemption opened: {} | Redeemable: {} USDC | Fees pending: {}",
        vault.vault_id,
        redeemable,
        fees
    );

    Ok(())
}

#[derive(Accounts)]
pub struct OpenRedemption<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        constraint = vault_usdc.key() == vault.vault_usdc
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub admin: Signer<'info>,
}
