use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{Vault, VaultPhase};
use crate::errors::VaultError;

/// Sweep accumulated fees to the treasury wallet.
/// Only callable after settlement (Settled or RedemptionOpen phase).
///
/// Security (Polynomial M-3): Cannot sweep more than collected fees.
/// Does not interfere with redeemable amounts.
pub fn handler(ctx: Context<SweepFee>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Only allow fee sweep after settlement
    require!(
        vault.phase == VaultPhase::Settled || vault.phase == VaultPhase::RedemptionOpen,
        VaultError::InvalidPhase
    );

    let sweepable = vault.fees_collected.saturating_sub(vault.fees_swept);
    require!(amount <= sweepable, VaultError::FeeSweepExceedsCollected);

    // Transfer fees from vault to treasury
    let vault_id = vault.vault_id.clone();
    let admin_key = vault.admin;
    let bump = vault.bump;
    let seeds = &[
        b"vault".as_ref(),
        admin_key.as_ref(),
        vault_id.as_bytes(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_usdc.to_account_info(),
                to: ctx.accounts.treasury_usdc.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    vault.fees_swept = vault
        .fees_swept
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;

    msg!(
        "Fee swept: {} USDC to treasury | Total swept: {}/{}",
        amount,
        vault.fees_swept,
        vault.fees_collected
    );

    Ok(())
}

#[derive(Accounts)]
pub struct SweepFee<'info> {
    #[account(
        mut,
        has_one = admin @ VaultError::UnauthorizedAdmin,
        has_one = treasury,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        constraint = vault_usdc.key() == vault.vault_usdc
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    /// Treasury USDC account
    #[account(mut)]
    pub treasury_usdc: Account<'info, TokenAccount>,

    /// CHECK: Validated by has_one on vault
    pub treasury: AccountInfo<'info>,

    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
