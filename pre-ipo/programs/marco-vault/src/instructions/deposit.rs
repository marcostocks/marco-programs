use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::state::{BuyerState, Vault, VaultPhase};
use crate::errors::VaultError;

/// Deposit USDC into the vault during FundingOpen phase.
///
/// Security:
/// - Share tokens minted directly to depositor's ATA (Polynomial M-1: receiver validation).
/// - Enforces cap and deadline. Rejects if frozen.
/// - 1:1 share minting (1 USDC = 1 share token, both 6 decimals).
pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // Phase check
    vault.require_phase(VaultPhase::FundingOpen)?;

    // Guard checks
    require!(!vault.frozen, VaultError::DepositsFrozen);
    require!(amount > 0, VaultError::ZeroDeposit);

    // Deadline check
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < vault.deposit_deadline,
        VaultError::DepositWindowClosed
    );

    // Cap check
    let new_total = vault
        .total_deposits
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;
    require!(new_total <= vault.deposit_cap, VaultError::DepositExceedsCap);

    // Transfer USDC from depositor to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor_usdc.to_account_info(),
                to: ctx.accounts.vault_usdc.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
    )?;

    // Mint share tokens 1:1 to depositor's share ATA
    // Vault PDA is the mint authority
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

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.depositor_shares.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount, // 1:1 with USDC (both 6 decimals)
    )?;

    // Update vault state
    vault.total_deposits = new_total;
    vault.total_shares = vault
        .total_shares
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;

    // Update buyer state
    let buyer = &mut ctx.accounts.buyer_state;
    buyer.bump = ctx.bumps.buyer_state;
    buyer.vault = ctx.accounts.vault.key();
    buyer.depositor = ctx.accounts.depositor.key();
    buyer.deposit_amount = buyer
        .deposit_amount
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;
    buyer.shares_minted = buyer
        .shares_minted
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;

    msg!(
        "Deposit: {} USDC from {} | Total: {}/{}",
        amount,
        ctx.accounts.depositor.key(),
        vault.total_deposits,
        vault.deposit_cap
    );

    // Auto-close if cap is exactly reached
    if vault.total_deposits >= vault.deposit_cap {
        vault.phase = VaultPhase::FundingClosed;
        msg!("Vault auto-closed: deposit cap reached");
    }

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init_if_needed,
        payer = depositor,
        space = BuyerState::MAX_SIZE,
        seeds = [b"buyer", vault.key().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub buyer_state: Account<'info, BuyerState>,

    #[account(
        mut,
        constraint = share_mint.key() == vault.share_mint
    )]
    pub share_mint: Account<'info, Mint>,

    /// Depositor's USDC token account (source)
    #[account(
        mut,
        constraint = depositor_usdc.owner == depositor.key(),
        constraint = depositor_usdc.mint == vault_usdc.mint
    )]
    pub depositor_usdc: Account<'info, TokenAccount>,

    /// Vault's USDC token account (destination)
    #[account(
        mut,
        constraint = vault_usdc.key() == vault.vault_usdc
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    /// Depositor's share token account — shares minted HERE, not elsewhere (Polynomial M-1)
    #[account(
        mut,
        constraint = depositor_shares.owner == depositor.key(),
        constraint = depositor_shares.mint == vault.share_mint
    )]
    pub depositor_shares: Account<'info, TokenAccount>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
