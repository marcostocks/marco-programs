use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::state::{BuyerState, Vault, VaultPhase};

/// Subscribe USDC during the Funding phase.
///
/// Partial-fill: the vault accepts `min(amount, cap_remaining,
/// per_address_remaining)` and only that portion of USDC leaves the
/// depositor's wallet. Anything that doesn't fit simply isn't pulled —
/// no revert on an over-cap deposit, no separate refund transaction.
///
/// Security:
/// - Claim tokens are minted to the depositor's own ATA (receiver validation).
/// - Enforces the window, freeze flag, min deposit and per-address max.
/// - 1:1 minting (1 accepted USDC -> 1 claim token, both 6 decimals).
pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let vault_ai = ctx.accounts.vault.to_account_info();
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Funding)?;
    require!(!vault.frozen, VaultError::DepositsFrozen);
    require!(amount > 0, VaultError::ZeroDeposit);
    require!(amount >= vault.min_deposit, VaultError::BelowMinimum);

    let now = Clock::get()?.unix_timestamp;
    require!(now < vault.funding_deadline, VaultError::FundingClosed);

    // How much room is left, globally and for this address.
    let cap_remaining = vault.deposit_cap.saturating_sub(vault.total_deposits);
    require!(cap_remaining > 0, VaultError::CapFull);

    let buyer_prior = ctx.accounts.buyer_state.deposit_amount;
    let addr_remaining = if vault.max_deposit > 0 {
        vault.max_deposit.saturating_sub(buyer_prior)
    } else {
        u64::MAX
    };
    require!(addr_remaining > 0, VaultError::AddressLimitReached);

    // Accepted = smallest of intent, cap room, per-address room.
    let accepted = amount.min(cap_remaining).min(addr_remaining);
    require!(accepted > 0, VaultError::CapFull);

    // Pull only the accepted USDC.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor_usdc.to_account_info(),
                to: ctx.accounts.vault_usdc.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        accepted,
    )?;

    // Mint claim tokens 1:1 (vault PDA is mint authority).
    let admin_key = vault.admin;
    let vault_id = vault.vault_id.clone();
    let bump = vault.bump;
    let seeds = &[b"vault".as_ref(), admin_key.as_ref(), vault_id.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.depositor_shares.to_account_info(),
                authority: vault_ai,
            },
            signer,
        ),
        accepted,
    )?;

    vault.total_deposits = vault.total_deposits.checked_add(accepted).ok_or(VaultError::Overflow)?;
    vault.total_shares = vault.total_shares.checked_add(accepted).ok_or(VaultError::Overflow)?;

    let buyer = &mut ctx.accounts.buyer_state;
    buyer.bump = ctx.bumps.buyer_state;
    buyer.vault = vault.key();
    buyer.depositor = ctx.accounts.depositor.key();
    buyer.deposit_amount = buyer.deposit_amount.checked_add(accepted).ok_or(VaultError::Overflow)?;
    buyer.shares_minted = buyer.shares_minted.checked_add(accepted).ok_or(VaultError::Overflow)?;

    msg!(
        "Deposit: intent {} accepted {} | total {}/{}",
        amount,
        accepted,
        vault.total_deposits,
        vault.deposit_cap
    );

    // Auto-seal when the cap is reached.
    if vault.total_deposits >= vault.deposit_cap {
        vault.phase = VaultPhase::Sealed;
        msg!("Vault sealed: cap reached");
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
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        init_if_needed,
        payer = depositor,
        space = BuyerState::MAX_SIZE,
        seeds = [b"buyer", vault.key().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub buyer_state: Box<Account<'info, BuyerState>>,

    #[account(mut, constraint = share_mint.key() == vault.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        constraint = depositor_usdc.owner == depositor.key(),
        constraint = depositor_usdc.mint == vault_usdc.mint
    )]
    pub depositor_usdc: Box<Account<'info, TokenAccount>>,

    #[account(mut, constraint = vault_usdc.key() == vault.vault_usdc)]
    pub vault_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = depositor_shares.owner == depositor.key(),
        constraint = depositor_shares.mint == vault.share_mint
    )]
    pub depositor_shares: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
