use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::state::{BuyerState, Vault, VaultPhase};

/// Burn claim tokens and receive pro-rata USDC.
/// payout = redeemable_amount * shares / total_shares (u128 math).
/// Allowed in Claimable and Winding; blocked once Concluded.
pub fn handler(ctx: Context<Claim>, shares_amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.phase == VaultPhase::Claimable || vault.phase == VaultPhase::Winding,
        VaultError::InvalidPhase
    );
    require!(shares_amount > 0, VaultError::ZeroRedemption);
    require!(vault.redeemable_amount > 0, VaultError::NoRedeemableAmount);

    let payout = vault.redeem_amount(shares_amount);
    require!(payout > 0, VaultError::ZeroRedemption);

    require!(
        ctx.accounts.claimant_shares.amount >= shares_amount,
        VaultError::InsufficientShares
    );

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.claimant_shares.to_account_info(),
                authority: ctx.accounts.claimant.to_account_info(),
            },
        ),
        shares_amount,
    )?;

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
                to: ctx.accounts.claimant_usdc.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        ),
        payout,
    )?;

    vault.total_redeemed_shares =
        vault.total_redeemed_shares.checked_add(shares_amount).ok_or(VaultError::Overflow)?;
    vault.total_redeemed_usdc =
        vault.total_redeemed_usdc.checked_add(payout).ok_or(VaultError::Overflow)?;

    let buyer = &mut ctx.accounts.buyer_state;
    buyer.shares_redeemed =
        buyer.shares_redeemed.checked_add(shares_amount).ok_or(VaultError::Overflow)?;
    buyer.usdc_redeemed = buyer.usdc_redeemed.checked_add(payout).ok_or(VaultError::Overflow)?;

    msg!("Claim: {} tokens -> {} USDC", shares_amount, payout);
    Ok(())
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [b"buyer", vault.key().as_ref(), claimant.key().as_ref()],
        bump = buyer_state.bump,
        constraint = buyer_state.vault == vault.key(),
        constraint = buyer_state.depositor == claimant.key()
    )]
    pub buyer_state: Account<'info, BuyerState>,

    #[account(mut, constraint = share_mint.key() == vault.share_mint)]
    pub share_mint: Account<'info, Mint>,

    #[account(mut, constraint = vault_usdc.key() == vault.vault_usdc)]
    pub vault_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = claimant_shares.owner == claimant.key(),
        constraint = claimant_shares.mint == vault.share_mint
    )]
    pub claimant_shares: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = claimant_usdc.owner == claimant.key(),
        constraint = claimant_usdc.mint == vault_usdc.mint
    )]
    pub claimant_usdc: Account<'info, TokenAccount>,

    #[account(mut)]
    pub claimant: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
