use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// Send subscribed USDC to the broker. Sourced -> Deployed on the first
/// call; further partial deploys are allowed while Deployed.
///
/// Security:
/// - Destination is pinned to the IMMUTABLE `deposit_destination` set at
///   creation. Capital cannot be routed anywhere else.
/// - Total deployed can never exceed the confirmed deployable allocation,
///   so the undeployed remainder stays in the vault for redemption.
pub fn handler(ctx: Context<DeployCapital>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.phase == VaultPhase::Sourced || vault.phase == VaultPhase::Deployed,
        VaultError::InvalidPhase
    );
    require!(amount > 0, VaultError::ZeroDeposit);

    let remaining = vault.deployable_amount.saturating_sub(vault.total_deployed);
    require!(amount <= remaining, VaultError::ExceedsDeployable);

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
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    vault.total_deployed = vault.total_deployed.checked_add(amount).ok_or(VaultError::Overflow)?;
    if vault.phase == VaultPhase::Sourced {
        vault.phase = VaultPhase::Deployed;
    }

    msg!("Deployed {} to broker | total {}/{}", amount, vault.total_deployed, vault.deployable_amount);
    Ok(())
}

#[derive(Accounts)]
pub struct DeployCapital<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump,
        constraint = (
            admin_or_operator.key() == vault.admin ||
            admin_or_operator.key() == vault.operator
        ) @ VaultError::UnauthorizedOperator
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut, constraint = vault_usdc.key() == vault.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,

    /// The broker destination — must equal the immutable account fixed at creation.
    #[account(mut, constraint = destination.key() == vault.deposit_destination @ VaultError::WrongDestination)]
    pub destination: Account<'info, TokenAccount>,

    pub admin_or_operator: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
