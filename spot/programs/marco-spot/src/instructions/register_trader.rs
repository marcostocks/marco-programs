use anchor_lang::prelude::*;

use crate::state::TraderAccount;

/// Record a trader's eligibility after off-chain identity verification.
///
/// The program does not perform KYC — it stores the outcome. Marco (or its
/// compliance provider) verifies identity and jurisdiction off-chain and
/// writes the result here; `place_buy` and `place_sell` read the flag.
///
/// The record is keyed by the signing admin rather than by market, so one
/// verification covers every market in the deployment. Eligibility is
/// revocable: calling again with `eligible = false` blocks new orders
/// immediately. It does not touch positions the trader already holds —
/// revocation stops new trading, it does not confiscate.
pub fn handler(ctx: Context<RegisterTrader>, eligible: bool, jurisdiction: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let acct = &mut ctx.accounts.trader_account;

    if acct.registered_at == 0 {
        acct.bump = ctx.bumps.trader_account;
        acct.admin = ctx.accounts.admin.key();
        acct.trader = ctx.accounts.trader.key();
        acct.registered_at = now;
        acct._reserved = [0u8; 32];
    }

    acct.eligible = eligible;
    acct.jurisdiction = jurisdiction;
    acct.updated_at = now;

    msg!(
        "Trader {} eligibility -> {} (jurisdiction {})",
        acct.trader,
        eligible,
        jurisdiction
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterTrader<'info> {
    #[account(
        init_if_needed,
        payer = admin,
        space = TraderAccount::MAX_SIZE,
        seeds = [b"trader", admin.key().as_ref(), trader.key().as_ref()],
        bump
    )]
    pub trader_account: Box<Account<'info, TraderAccount>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: the wallet being vouched for; stored as a pubkey only.
    pub trader: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
