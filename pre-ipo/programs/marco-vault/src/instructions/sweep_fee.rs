use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Sweep collected protocol fees to the treasury. Only post-settlement
/// (Claimable, Winding or Concluded). Bounded by fees_collected - fees_swept,
/// so it can never touch depositors' redeemable balance. Admin only.
pub fn handler(ctx: Context<SweepFee>, amount: u64) -> Result<()> {
    let vault_ai = ctx.accounts.vault.to_account_info();
    let vault = &mut ctx.accounts.vault;
    require!(
        matches!(
            vault.phase,
            VaultPhase::Claimable | VaultPhase::Winding | VaultPhase::Concluded
        ),
        VaultError::InvalidPhase
    );

    // Bounded by EARNED fee only. Anything still in `fees_escrowed` belongs
    // to depositors until capital deploys and can never be swept.
    require!(
        amount <= vault.fees_outstanding(),
        VaultError::FeeSweepExceedsCollected
    );

    let admin_key = vault.admin;
    let vault_id = vault.vault_id.clone();
    let bump = vault.bump;
    let seeds = &[b"vault".as_ref(), admin_key.as_ref(), vault_id.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_usdc.to_account_info(),
                to: ctx.accounts.treasury_usdc.to_account_info(),
                authority: vault_ai,
            },
            signer,
        ),
        amount,
    )?;

    vault.fees_swept = vault.fees_swept.checked_add(amount).ok_or(VaultError::Overflow)?;
    msg!("Fee swept {} | total {}/{}", amount, vault.fees_swept, vault.fees_collected);
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

    #[account(mut, constraint = vault_usdc.key() == vault.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury_usdc: Account<'info, TokenAccount>,

    /// CHECK: validated by has_one = treasury on the vault.
    pub treasury: AccountInfo<'info>,

    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
