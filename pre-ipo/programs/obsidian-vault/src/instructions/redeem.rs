use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::state::{BuyerState, Vault, VaultPhase};
use crate::errors::VaultError;

/// Burn share tokens and receive pro-rata USDC proceeds.
///
/// Formula: payout = (redeemable_amount * shares_burned) / total_shares
///
/// Security: Uses u128 intermediate math to prevent overflow on large vaults.
pub fn handler(ctx: Context<Redeem>, shares_amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::RedemptionOpen)?;

    require!(shares_amount > 0, VaultError::ZeroRedemption);
    require!(vault.redeemable_amount > 0, VaultError::NoRedeemableAmount);

    // Calculate pro-rata USDC payout
    let payout = vault.redeem_amount(shares_amount);
    require!(payout > 0, VaultError::ZeroRedemption);

    // Verify user has enough shares
    let buyer = &ctx.accounts.buyer_state;
    let user_balance = ctx.accounts.redeemer_shares.amount;
    require!(user_balance >= shares_amount, VaultError::InsufficientShares);

    // Burn share tokens
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.redeemer_shares.to_account_info(),
                authority: ctx.accounts.redeemer.to_account_info(),
            },
        ),
        shares_amount,
    )?;

    // Transfer USDC from vault to redeemer
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
                to: ctx.accounts.redeemer_usdc.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        payout,
    )?;

    // Update vault state
    vault.total_redeemed_shares = vault
        .total_redeemed_shares
        .checked_add(shares_amount)
        .ok_or(VaultError::Overflow)?;
    vault.total_redeemed_usdc = vault
        .total_redeemed_usdc
        .checked_add(payout)
        .ok_or(VaultError::Overflow)?;

    // Update buyer state
    let buyer = &mut ctx.accounts.buyer_state;
    buyer.shares_redeemed = buyer
        .shares_redeemed
        .checked_add(shares_amount)
        .ok_or(VaultError::Overflow)?;
    buyer.usdc_redeemed = buyer
        .usdc_redeemed
        .checked_add(payout)
        .ok_or(VaultError::Overflow)?;

    msg!(
        "Redeemed: {} shares → {} USDC for {} | Remaining: {}/{}",
        shares_amount,
        payout,
        ctx.accounts.redeemer.key(),
        vault.total_shares.saturating_sub(vault.total_redeemed_shares),
        vault.total_shares
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [b"buyer", vault.key().as_ref(), redeemer.key().as_ref()],
        bump = buyer_state.bump,
        constraint = buyer_state.vault == vault.key(),
        constraint = buyer_state.depositor == redeemer.key()
    )]
    pub buyer_state: Account<'info, BuyerState>,

    #[account(
        mut,
        constraint = share_mint.key() == vault.share_mint
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = vault_usdc.key() == vault.vault_usdc
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    /// Redeemer's share token account (shares burned from here)
    #[account(
        mut,
        constraint = redeemer_shares.owner == redeemer.key(),
        constraint = redeemer_shares.mint == vault.share_mint
    )]
    pub redeemer_shares: Account<'info, TokenAccount>,

    /// Redeemer's USDC account (proceeds sent here)
    #[account(
        mut,
        constraint = redeemer_usdc.owner == redeemer.key(),
        constraint = redeemer_usdc.mint == vault_usdc.mint
    )]
    pub redeemer_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub redeemer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
