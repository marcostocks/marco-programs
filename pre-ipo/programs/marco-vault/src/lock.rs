use anchor_lang::prelude::*;
use anchor_spl::token::spl_token::state::AccountState;
use anchor_spl::token::{self, FreezeAccount, ThawAccount, TokenAccount};

// ═══════════════════════════════════════════════════════════════
// CLAIM-TOKEN LOCK
//
// Claim tokens are locked in the holder's own wallet for the life of
// the vault. The lock is the SPL freeze authority, held by the vault
// PDA: a holder's claim-token account is frozen the moment tokens are
// minted into it, so the tokens cannot be transferred or sold on.
//
// A frozen SPL account can be neither minted to NOR burned from, so
// every path that moves claim tokens has to thaw first and re-freeze
// after. That is what these two helpers are for — the vault PDA is the
// only freeze authority, so only this program can open the window, and
// it closes it again in the same instruction.
//
// The lock is deliberately reversible (freeze authority rather than a
// Token-2022 non-transferable mint): if Marco ever wants a secondary
// market in claim tokens, `set_transfer_lock(false)` plus per-holder
// `unlock_shares` lifts it with no program upgrade.
// ═══════════════════════════════════════════════════════════════

/// Thaw a holder's claim-token account if it is frozen. No-op otherwise,
/// so this is safe to call unconditionally before a mint or a burn.
pub fn thaw_if_frozen<'info>(
    token_program: &AccountInfo<'info>,
    shares: &Account<'info, TokenAccount>,
    mint: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    if shares.state != AccountState::Frozen {
        return Ok(());
    }
    token::thaw_account(CpiContext::new_with_signer(
        token_program.clone(),
        ThawAccount {
            account: shares.to_account_info(),
            mint: mint.clone(),
            authority: vault_authority.clone(),
        },
        signer,
    ))
}

/// Re-freeze a holder's claim-token account, locking the balance in place.
/// Callers skip this when the vault's transfer lock has been lifted, or
/// when the account has been fully burned down to zero (a frozen account
/// cannot be closed, so leaving an empty one frozen would strand rent).
pub fn freeze_shares<'info>(
    token_program: &AccountInfo<'info>,
    shares: &Account<'info, TokenAccount>,
    mint: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token::freeze_account(CpiContext::new_with_signer(
        token_program.clone(),
        FreezeAccount {
            account: shares.to_account_info(),
            mint: mint.clone(),
            authority: vault_authority.clone(),
        },
        signer,
    ))
}
