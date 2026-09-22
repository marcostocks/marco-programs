use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::errors::VaultError;
use crate::lock;
use crate::state::{BuyerState, Vault, VaultPhase};

/// Burn claim tokens and receive pro-rata USDC.
/// gross = redeemable_amount * shares / cash_shares (u128 math). An exit-fee
/// vault then deducts the fee and pays the net; an entry-fee vault already took
/// the fee at deposit and pays the full gross. Allowed in Claimable and
/// Winding; blocked once Concluded.
///
/// The exit fee is `fee_bps` of the REDEMPTION VALUE — `fee_on(gross)`, what the
/// holder is actually withdrawing. It therefore scales with the outcome: on a
/// 1,000 subscription at 500 bps, a flat deal pays 950, a +20% deal pays 1,140
/// (fee 60) and a −20% deal pays 760 (fee 40). This is the conventional exit
/// load: the protocol takes its cut of the proceeds, sharing the outcome rather
/// than charging a fixed amount regardless of it. Because it is a fraction of
/// `gross` it can never exceed it, so the payout cannot underflow.
pub fn handler(ctx: Context<Claim>, shares_amount: u64) -> Result<()> {
    let vault_ai = ctx.accounts.vault.to_account_info();
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.phase == VaultPhase::Claimable || vault.phase == VaultPhase::Winding,
        VaultError::InvalidPhase
    );
    require!(shares_amount > 0, VaultError::ZeroRedemption);
    require!(vault.redeemable_amount > 0, VaultError::NoRedeemableAmount);

    // Gross pro-rata share of the redeemable pool.
    let gross = vault.redeem_amount(shares_amount);
    require!(gross > 0, VaultError::ZeroRedemption);

    // Exit-fee vaults charge the fee on the redemption value, so it scales with
    // the outcome. The holder is paid the net and the fee stays in the vault as
    // collected fee for the treasury to sweep. Entry-fee vaults already took it
    // at deposit, so they pay the full gross. `settle` leaves the whole balance
    // redeemable for an exit-fee vault (nothing was withheld earlier), so the
    // fee is realised only as it is skimmed here.
    let fee = if vault.fee_at_exit { vault.fee_on(gross) } else { 0 };
    let payout = gross.checked_sub(fee).ok_or(VaultError::Overflow)?;
    require!(payout > 0, VaultError::ZeroRedemption);

    require!(
        ctx.accounts.claimant_shares.amount >= shares_amount,
        VaultError::InsufficientShares
    );

    let admin_key = vault.admin;
    let vault_id = vault.vault_id.clone();
    let bump = vault.bump;
    let transfer_lock = vault.transfer_lock;
    let seeds = &[b"vault".as_ref(), admin_key.as_ref(), vault_id.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    let token_program = ctx.accounts.token_program.to_account_info();
    let mint_ai = ctx.accounts.share_mint.to_account_info();
    let remaining = ctx.accounts.claimant_shares.amount.saturating_sub(shares_amount);

    // Locked claim tokens are frozen, and a frozen account cannot be burned
    // from. Thaw, burn, then re-lock whatever balance is left.
    lock::thaw_if_frozen(
        &token_program,
        &ctx.accounts.claimant_shares,
        &mint_ai,
        &vault_ai,
        signer,
    )?;

    token::burn(
        CpiContext::new(
            token_program.clone(),
            Burn {
                mint: mint_ai.clone(),
                from: ctx.accounts.claimant_shares.to_account_info(),
                authority: ctx.accounts.claimant.to_account_info(),
            },
        ),
        shares_amount,
    )?;

    // Only re-freeze if tokens remain. A frozen account cannot be closed,
    // so re-locking an emptied one would strand the holder's rent.
    if transfer_lock && remaining > 0 {
        lock::freeze_shares(
            &token_program,
            &ctx.accounts.claimant_shares,
            &mint_ai,
            &vault_ai,
            signer,
        )?;
    }

    token::transfer(
        CpiContext::new_with_signer(
            token_program.clone(),
            Transfer {
                from: ctx.accounts.vault_usdc.to_account_info(),
                to: ctx.accounts.claimant_usdc.to_account_info(),
                authority: vault_ai.clone(),
            },
            signer,
        ),
        payout,
    )?;

    vault.total_redeemed_shares =
        vault.total_redeemed_shares.checked_add(shares_amount).ok_or(VaultError::Overflow)?;
    vault.total_redeemed_usdc =
        vault.total_redeemed_usdc.checked_add(payout).ok_or(VaultError::Overflow)?;
    // The exit fee (0 for an entry-fee vault) stays in the vault's USDC account
    // and is booked as collected, so `sweep_fee` can move it to the treasury.
    vault.fees_collected =
        vault.fees_collected.checked_add(fee).ok_or(VaultError::Overflow)?;

    let buyer = &mut ctx.accounts.buyer_state;
    buyer.shares_redeemed =
        buyer.shares_redeemed.checked_add(shares_amount).ok_or(VaultError::Overflow)?;
    buyer.usdc_redeemed = buyer.usdc_redeemed.checked_add(payout).ok_or(VaultError::Overflow)?;

    msg!("Claim: {} tokens -> {} USDC (fee {})", shares_amount, payout, fee);

    emit!(crate::events::ClaimMade {
        vault: vault.key(),
        vault_id,
        claimant: ctx.accounts.claimant.key(),
        shares_burned: shares_amount,
        usdc_paid: payout,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [b"buyer", vault.key().as_ref(), claimant.key().as_ref()],
        bump = buyer_state.bump,
        constraint = buyer_state.vault == vault.key(),
        constraint = buyer_state.depositor == claimant.key()
    )]
    pub buyer_state: Box<Account<'info, BuyerState>>,

    #[account(mut, constraint = share_mint.key() == vault.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    #[account(mut, constraint = vault_usdc.key() == vault.vault_usdc)]
    pub vault_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = claimant_shares.owner == claimant.key(),
        constraint = claimant_shares.mint == vault.share_mint
    )]
    pub claimant_shares: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = claimant_usdc.owner == claimant.key(),
        constraint = claimant_usdc.mint == vault_usdc.mint
    )]
    pub claimant_usdc: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub claimant: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
