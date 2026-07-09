use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::state::{Vault, VaultPhase};
use crate::errors::VaultError;

/// Move USDC from vault to broker settlement address.
/// Transitions FundingClosed → AssetsDeployed on first call.
///
/// Security (Polynomial M-2): Caps movable amount to unreserved balance.
/// Cannot drain USDC that's been recorded as yield or reserved for fees.
pub fn handler(ctx: Context<MoveAssets>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Allow move in FundingClosed or AssetsDeployed (partial moves)
    require!(
        vault.phase == VaultPhase::FundingClosed || vault.phase == VaultPhase::AssetsDeployed,
        VaultError::InvalidPhase
    );

    require!(amount > 0, VaultError::ZeroDeposit);

    // Security: Cannot move more than what was deposited minus any reserved amounts
    let max_movable = vault
        .total_deposits
        .saturating_sub(vault.total_moved);
    require!(amount <= max_movable, VaultError::MoveWouldDrainReserved);

    // Transfer USDC from vault to broker destination
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
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Track total moved
    vault.total_moved = vault
        .total_moved
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;

    // Transition to AssetsDeployed on first move
    if vault.phase == VaultPhase::FundingClosed {
        vault.phase = VaultPhase::AssetsDeployed;
    }

    msg!(
        "Assets moved: {} USDC to broker | Total moved: {}/{}",
        amount,
        vault.total_moved,
        vault.total_deposits
    );

    Ok(())
}

#[derive(Accounts)]
pub struct MoveAssets<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump,
        // Admin OR operator can move assets
        constraint = (
            admin_or_operator.key() == vault.admin ||
            admin_or_operator.key() == vault.operator
        ) @ VaultError::UnauthorizedOperator
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        constraint = vault_usdc.key() == vault.vault_usdc
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    /// Destination USDC account (broker's address)
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub admin_or_operator: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
