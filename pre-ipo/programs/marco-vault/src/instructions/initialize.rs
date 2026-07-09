use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};

use crate::errors::VaultError;
use crate::state::{Vault, VaultPhase};

/// All vault parameters, frozen at creation. Grouped into one struct so
/// the entrypoint stays readable and the client passes a single object.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct VaultParams {
    pub vault_id: String,
    pub deposit_cap: u64,
    pub min_deposit: u64,
    /// 0 = no per-address maximum.
    pub max_deposit: u64,
    pub funding_start: i64,
    pub funding_deadline: i64,
    pub close_out_at: i64,
    pub fee_bps: u16,
}

pub fn handler(ctx: Context<InitializeVault>, p: VaultParams) -> Result<()> {
    require!(!p.vault_id.is_empty() && p.vault_id.len() <= 64, VaultError::VaultIdTooLong);
    require!(p.fee_bps <= Vault::MAX_FEE_BPS, VaultError::FeeTooHigh);
    require!(p.deposit_cap > 0, VaultError::InvalidParameter);
    require!(p.funding_deadline > p.funding_start, VaultError::InvalidParameter);
    require!(p.close_out_at >= p.funding_deadline, VaultError::InvalidParameter);
    if p.max_deposit > 0 {
        require!(p.max_deposit >= p.min_deposit, VaultError::InvalidParameter);
    }

    let vault = &mut ctx.accounts.vault;
    vault.bump = ctx.bumps.vault;
    vault.admin = ctx.accounts.admin.key();
    vault.operator = ctx.accounts.operator.key();
    vault.treasury = ctx.accounts.treasury.key();
    vault.deposit_destination = ctx.accounts.deposit_destination.key();
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.vault_usdc = ctx.accounts.vault_usdc.key();

    vault.vault_id = p.vault_id;
    vault.phase = VaultPhase::Scheduled;
    vault.frozen = false;

    vault.deposit_cap = p.deposit_cap;
    vault.min_deposit = p.min_deposit;
    vault.max_deposit = p.max_deposit;
    vault.funding_start = p.funding_start;
    vault.funding_deadline = p.funding_deadline;
    vault.close_out_at = p.close_out_at;

    vault.total_deposits = 0;
    vault.total_shares = 0;
    vault.deployable_amount = 0;
    vault.undeployed_amount = 0;
    vault.total_deployed = 0;
    vault.gross_proceeds = 0;
    vault.settlement_amount = 0;
    vault.redeemable_amount = 0;
    vault.total_redeemed_shares = 0;
    vault.total_redeemed_usdc = 0;

    vault.fee_bps = p.fee_bps;
    vault.fees_collected = 0;
    vault.fees_swept = 0;
    vault.unrefundable_costs = 0;
    vault.total_refunded_usdc = 0;
    vault.shares_allocated = 0;
    vault.election_deadline = 0;
    vault.delivered_shares = 0;
    vault._reserved = [0u8; 104];

    msg!(
        "Vault {} created | cap {} | fee {} bps | broker {}",
        vault.vault_id,
        vault.deposit_cap,
        vault.fee_bps,
        vault.deposit_destination
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(p: VaultParams)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = admin,
        space = Vault::MAX_SIZE,
        seeds = [b"vault", admin.key().as_ref(), p.vault_id.as_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// Claim-token mint, 6 decimals to match USDC. Mint authority is the
    /// vault PDA so only the program can mint/burn.
    #[account(
        init,
        payer = admin,
        mint::decimals = 6,
        mint::authority = vault,
        seeds = [b"share_mint", vault.key().as_ref()],
        bump
    )]
    pub share_mint: Account<'info, Mint>,

    /// The vault's USDC token account (owned by the vault PDA).
    /// CHECK: validated as the vault's USDC ATA in deposit/claim constraints.
    pub vault_usdc: AccountInfo<'info>,

    /// IMMUTABLE broker/SPV USDC account. Only its key is stored; capital
    /// can only ever be deployed here.
    /// CHECK: recorded as a fixed pubkey; validated as a TokenAccount at deploy time.
    pub deposit_destination: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: stored as pubkey only.
    pub operator: AccountInfo<'info>,

    /// CHECK: stored as pubkey only.
    pub treasury: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
