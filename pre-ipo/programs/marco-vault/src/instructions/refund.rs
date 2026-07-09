use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::state::{BuyerState, Vault, VaultPhase};

/// Refund on a cancelled vault: burn claim tokens, receive principal less
/// the pro-rata share of disclosed unrefundable costs.
/// refund = (total_deposits - unrefundable_costs) * shares / total_shares.
pub fn handler(ctx: Context<Refund>, shares_amount: u64) -> Result<()> {
    let vault_ai = ctx.accounts.vault.to_account_info();
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Cancelled)?;
    require!(shares_amount > 0, VaultError::ZeroRedemption);

    let payout = vault.refund_amount(shares_amount);
    require!(payout > 0, VaultError::ZeroRedemption);

    require!(
        ctx.accounts.holder_shares.amount >= shares_amount,
        VaultError::InsufficientShares
    );

    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.holder_shares.to_account_info(),
                authority: ctx.accounts.holder.to_account_info(),
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
                to: ctx.accounts.holder_usdc.to_account_info(),
                authority: vault_ai,
            },
            signer,
        ),
        payout,
    )?;

    vault.total_refunded_usdc =
        vault.total_refunded_usdc.checked_add(payout).ok_or(VaultError::Overflow)?;

    let buyer = &mut ctx.accounts.buyer_state;
    buyer.shares_redeemed =
        buyer.shares_redeemed.checked_add(shares_amount).ok_or(VaultError::Overflow)?;
    buyer.usdc_refunded = buyer.usdc_refunded.checked_add(payout).ok_or(VaultError::Overflow)?;

    msg!("Refund: {} tokens -> {} USDC", shares_amount, payout);
    Ok(())
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [b"buyer", vault.key().as_ref(), holder.key().as_ref()],
        bump = buyer_state.bump,
        constraint = buyer_state.vault == vault.key(),
        constraint = buyer_state.depositor == holder.key()
    )]
    pub buyer_state: Box<Account<'info, BuyerState>>,

    #[account(mut, constraint = share_mint.key() == vault.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    #[account(mut, constraint = vault_usdc.key() == vault.vault_usdc)]
    pub vault_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = holder_shares.owner == holder.key(),
        constraint = holder_shares.mint == vault.share_mint
    )]
    pub holder_shares: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = holder_usdc.owner == holder.key(),
        constraint = holder_usdc.mint == vault_usdc.mint
    )]
    pub holder_usdc: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub holder: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
