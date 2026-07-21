use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::lock;
use crate::state::{BuyerState, Vault, VaultPhase};

/// Elect to take real shares instead of a cash redemption.
///
/// Allowed only while the vault is Live and the election window is open.
/// The holder pays the flat protocol fee in USDC, then `shares_amount`
/// claim tokens are burned — removing them from the cash cohort so the
/// remaining holders are never diluted. The vault records the real-share
/// entitlement (`shares_allocated * shares_amount / total_shares`); the
/// broker delivers those shares to the holder's brokerage account off-chain
/// and reconciles against `buyer_state.underlying_delivered`.
pub fn handler(ctx: Context<ElectDelivery>, shares_amount: u64) -> Result<()> {
    let vault_ai = ctx.accounts.vault.to_account_info();
    let vault = &mut ctx.accounts.vault;
    vault.require_phase(VaultPhase::Live)?;

    let now = Clock::get()?.unix_timestamp;
    require!(now < vault.election_deadline, VaultError::ElectionClosed);
    require!(shares_amount > 0, VaultError::ZeroRedemption);
    require!(vault.shares_allocated > 0, VaultError::AllocationNotSet);
    require!(
        ctx.accounts.holder_shares.amount >= shares_amount,
        VaultError::InsufficientShares
    );

    let fee = vault.delivery_fee(shares_amount);
    let underlying = vault.underlying_for(shares_amount);
    require!(underlying > 0, VaultError::ZeroRedemption);

    // Pay the protocol fee in USDC into the vault (swept to treasury later).
    if fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.holder_usdc.to_account_info(),
                    to: ctx.accounts.vault_usdc.to_account_info(),
                    authority: ctx.accounts.holder.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    // Burn the claim tokens — the holder gives up any cash redemption.
    // Locked tokens are frozen and a frozen account cannot be burned from,
    // so thaw first and re-lock any remaining balance afterwards.
    let admin_key = vault.admin;
    let vault_id = vault.vault_id.clone();
    let bump = vault.bump;
    let transfer_lock = vault.transfer_lock;
    let seeds = &[b"vault".as_ref(), admin_key.as_ref(), vault_id.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    let token_program = ctx.accounts.token_program.to_account_info();
    let mint_ai = ctx.accounts.share_mint.to_account_info();
    let remaining = ctx.accounts.holder_shares.amount.saturating_sub(shares_amount);

    lock::thaw_if_frozen(
        &token_program,
        &ctx.accounts.holder_shares,
        &mint_ai,
        &vault_ai,
        signer,
    )?;

    token::burn(
        CpiContext::new(
            token_program.clone(),
            Burn {
                mint: mint_ai.clone(),
                from: ctx.accounts.holder_shares.to_account_info(),
                authority: ctx.accounts.holder.to_account_info(),
            },
        ),
        shares_amount,
    )?;

    // Only re-freeze if tokens remain — a frozen account cannot be closed.
    if transfer_lock && remaining > 0 {
        lock::freeze_shares(
            &token_program,
            &ctx.accounts.holder_shares,
            &mint_ai,
            &vault_ai,
            signer,
        )?;
    }

    vault.delivered_shares =
        vault.delivered_shares.checked_add(shares_amount).ok_or(VaultError::Overflow)?;
    vault.fees_collected = vault.fees_collected.checked_add(fee).ok_or(VaultError::Overflow)?;

    let buyer = &mut ctx.accounts.buyer_state;
    buyer.shares_delivered =
        buyer.shares_delivered.checked_add(shares_amount).ok_or(VaultError::Overflow)?;
    buyer.underlying_delivered =
        buyer.underlying_delivered.checked_add(underlying).ok_or(VaultError::Overflow)?;
    buyer.delivery_fee_paid =
        buyer.delivery_fee_paid.checked_add(fee).ok_or(VaultError::Overflow)?;

    msg!(
        "Elect delivery: {} tokens -> {} shares | fee {} USDC",
        shares_amount,
        underlying,
        fee
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ElectDelivery<'info> {
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
