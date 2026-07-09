use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::state::{Vault, VaultPhase};
use crate::errors::VaultError;

/// Initialize a new IPO subscription vault.
///
/// Security: Admin pubkey included in PDA seeds to prevent front-running (Polynomial H-1, L-2).
/// Share mint decimals set to 6 to match USDC (Polynomial L-3).
pub fn handler(
    ctx: Context<InitializeVault>,
    vault_id: String,
    deposit_cap: u64,
    deposit_deadline: i64,
    sourcing_spread_bps: u16,
) -> Result<()> {
    require!(vault_id.len() <= 64, VaultError::VaultIdTooLong);
    require!(sourcing_spread_bps <= 2000, VaultError::SourcingSpreadTooHigh); // Max 20%
    require!(deposit_cap > 0, VaultError::ZeroDeposit);

    let vault = &mut ctx.accounts.vault;
    vault.bump = ctx.bumps.vault;
    vault.admin = ctx.accounts.admin.key();
    vault.operator = ctx.accounts.operator.key();
    vault.treasury = ctx.accounts.treasury.key();
    vault.vault_id = vault_id;
    vault.phase = VaultPhase::FundingOpen;
    vault.deposit_cap = deposit_cap;
    vault.deposit_deadline = deposit_deadline;
    vault.total_deposits = 0;
    vault.total_shares = 0;
    vault.settlement_amount = 0;
    vault.redeemable_amount = 0;
    vault.total_redeemed_shares = 0;
    vault.total_redeemed_usdc = 0;
    vault.sourcing_spread_bps = sourcing_spread_bps;
    vault.fees_collected = 0;
    vault.fees_swept = 0;
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.vault_usdc = ctx.accounts.vault_usdc.key();
    vault.total_moved = 0;
    vault.frozen = false;
    vault._reserved = [0u8; 128];

    msg!(
        "Vault initialized: {} | Cap: {} USDC | Deadline: {}",
        vault.vault_id,
        deposit_cap,
        deposit_deadline
    );

    Ok(())
}

#[derive(Accounts)]
#[instruction(vault_id: String)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = admin,
        space = Vault::MAX_SIZE,
        seeds = [b"vault", admin.key().as_ref(), vault_id.as_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// Share token mint — created with 6 decimals to match USDC (Polynomial L-3).
    /// Mint authority is the vault PDA so only the program can mint/burn.
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = vault,
        seeds = [b"share_mint", vault.key().as_ref()],
        bump
    )]
    pub share_mint: Account<'info, Mint>,

    /// Vault's USDC token account
    /// CHECK: Validated as ATA in the client; passed as account info here
    pub vault_usdc: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// Operator wallet (can be same as admin)
    /// CHECK: Just stored as pubkey, no signing required at init
    pub operator: AccountInfo<'info>,

    /// Treasury wallet for fee collection
    /// CHECK: Just stored as pubkey
    pub treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
