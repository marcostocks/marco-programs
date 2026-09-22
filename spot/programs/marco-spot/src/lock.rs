use anchor_lang::prelude::*;
use anchor_spl::token::spl_token::state::AccountState;
use anchor_spl::token::{self, FreezeAccount, ThawAccount, TokenAccount};

// ═══════════════════════════════════════════════════════════════
// POSITION-TOKEN LOCK
//
// Phase 1 spot positions are non-transferable: the token records real,
// custodied ownership but stays locked to the holder's wallet. The lock
// is the SPL freeze authority, held by the market PDA, so a holder's
// position account is frozen the moment tokens are minted into it.
//
// A frozen SPL account can be neither minted to NOR transferred from,
// so every path that moves position tokens has to thaw first and
// re-freeze after. The market PDA is the only freeze authority, so only
// this program can open the window and it closes it in the same
// instruction.
//
// Phase 2 unlocks the claim into a freely tradable, composable token via
// `set_transfer_lock(false)` + per-holder `unlock_position` — no program
// upgrade, because the lock is an authority rather than a Token-2022
// non-transferable mint.
// ═══════════════════════════════════════════════════════════════

/// Thaw a holder's position account if frozen. No-op otherwise, so it is
/// safe to call unconditionally before a mint or transfer.
pub fn thaw_if_frozen<'info>(
    token_program: &AccountInfo<'info>,
    shares: &Account<'info, TokenAccount>,
    mint: &AccountInfo<'info>,
    market_authority: &AccountInfo<'info>,
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
            authority: market_authority.clone(),
        },
        signer,
    ))
}

/// Re-freeze a holder's position account, locking the balance in place.
/// Callers skip this once the market's transfer lock is lifted, and when
/// the account has gone to zero — a frozen account cannot be closed, so
/// re-locking an emptied one would strand the holder's rent.
pub fn freeze_shares<'info>(
    token_program: &AccountInfo<'info>,
    shares: &Account<'info, TokenAccount>,
    mint: &AccountInfo<'info>,
    market_authority: &AccountInfo<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token::freeze_account(CpiContext::new_with_signer(
        token_program.clone(),
        FreezeAccount {
            account: shares.to_account_info(),
            mint: mint.clone(),
            authority: market_authority.clone(),
        },
        signer,
    ))
}
