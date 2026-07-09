use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Realized -> Claimable. Called after the broker has wired the net USDC
/// back into the vault's USDC account.
///
/// - Records `net_amount` as the settlement figure.
/// - Computes the flat protocol fee (`fee_bps` of settlement).
/// - Sets `redeemable_amount` to the FULL vault balance minus the fee, so
///   any undeployed remainder and rounding dust stay redeemable (no stuck
///   USDC).
pub fn handler(ctx: Context<Settle>, net_amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Realized)?;
    require!(net_amount > 0, VaultError::ZeroSettlement);

    vault.settlement_amount = net_amount;
    // Add the settlement fee to any fees already collected from delivery
    // elections, so both are excluded from the redeemable pool and both
    // remain sweepable to the treasury.
    vault.fees_collected = vault
        .fees_collected
        .checked_add(vault.protocol_fee())
        .ok_or(VaultError::Overflow)?;

    let balance = ctx.accounts.vault_usdc.amount;
    let redeemable = balance.saturating_sub(vault.fees_collected);
    require!(redeemable > 0, VaultError::NoRedeemableAmount);

    vault.redeemable_amount = redeemable;
    vault.phase = VaultPhase::Claimable;

    msg!(
        "Settled | net {} | fee {} | redeemable {} | balance {}",
        net_amount,
        vault.fees_collected,
        redeemable,
        balance
    );
    Ok(())
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(constraint = vault_usdc.key() == vault.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub admin: Signer<'info>,
}
