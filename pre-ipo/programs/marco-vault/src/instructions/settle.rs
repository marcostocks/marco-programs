use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Realized -> Claimable. Called after the broker has wired the net USDC
/// back into the vault's USDC account.
///
/// No fee is charged here in either mode; settlement only opens redemption.
/// `redeemable_amount` is set to the vault balance less any fee already
/// *collected* and awaiting sweep — so the undeployed remainder and rounding
/// dust stay redeemable and nothing is stranded:
///
/// - Entry-fee vault: the fee was earned at deployment, so it sits in
///   `fees_collected` now and is excluded from the pool here.
/// - Exit-fee vault: no fee has been collected yet (it is skimmed at each
///   `claim`), so `fees_outstanding` is zero and the whole balance is
///   redeemable; the fee is realised only as holders redeem.
pub fn handler(ctx: Context<Settle>, net_amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Realized)?;
    require!(net_amount > 0, VaultError::ZeroSettlement);

    // If every holder elected share delivery there is no cash cohort, so a
    // settlement would have no one to divide among and the balance would sit
    // unclaimable forever. Fail loudly instead of stranding it silently — a
    // fully-elected vault should be concluded, not settled.
    require!(vault.cash_shares() > 0, VaultError::NoCashCohort);

    vault.settlement_amount = net_amount;

    // The only balance not belonging to depositors is the already-earned
    // entry fee that has not yet been swept to treasury.
    let balance = ctx.accounts.vault_usdc.amount;
    let redeemable = balance.saturating_sub(vault.fees_outstanding());
    require!(redeemable > 0, VaultError::NoRedeemableAmount);

    vault.redeemable_amount = redeemable;
    vault.phase = VaultPhase::Claimable;

    msg!(
        "Settled | net {} | redeemable {} | balance {} | unswept fee {}",
        net_amount,
        redeemable,
        balance,
        vault.fees_outstanding()
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
