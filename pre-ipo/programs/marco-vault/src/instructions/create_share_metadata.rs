use anchor_lang::prelude::*;
use anchor_spl::metadata::{
    create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
    Metadata,
};
use anchor_spl::token::Mint;

use crate::errors::VaultError;
use crate::state::Vault;

/// Attach Metaplex Token Metadata to a vault's claim-token mint, so wallets show
/// a name and a symbol instead of a bare pubkey.
///
/// Why this has to live in the program at all: the claim mint's mint authority
/// is the vault PDA, and Metaplex requires the mint authority to sign. A PDA can
/// only sign through a CPI from the program that owns it, so no off-chain script
/// can do this however many keys it holds.
///
/// It works on a mint that already has supply — nothing here depends on the mint
/// being fresh — which is the point: every live vault was created before this
/// instruction existed.
///
/// Reads the vault and never writes it. That is deliberate and is the reason
/// this is safe to run against vaults holding real deposits: `vault` is not
/// `mut`, so the instruction is incapable of altering vault state.
///
/// Admin only.
pub fn handler(
    ctx: Context<CreateShareMetadata>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    // Metaplex enforces these lengths on-chain anyway (32 / 10 / 200). Checking
    // first turns an opaque Metaplex code into a named error.
    require!(!name.is_empty() && name.len() <= 32, VaultError::InvalidParameter);
    require!(!symbol.is_empty() && symbol.len() <= 10, VaultError::InvalidParameter);
    require!(uri.len() <= 200, VaultError::InvalidParameter);

    // Same signer-seeds block every CPI-signing handler here uses. `vault_id`
    // must be cloned: `seeds` borrows its bytes for the whole CPI.
    let vault_ai = ctx.accounts.vault.to_account_info();
    let admin_key = ctx.accounts.vault.admin;
    let vault_id = ctx.accounts.vault.vault_id.clone();
    let bump = ctx.accounts.vault.bump;
    let seeds = &[b"vault".as_ref(), admin_key.as_ref(), vault_id.as_bytes(), &[bump]];
    let signer = &[&seeds[..]];

    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.share_mint.to_account_info(),
                // The vault PDA — hence new_with_signer above.
                mint_authority: vault_ai,
                payer: ctx.accounts.admin.to_account_info(),
                // Admin rather than the vault PDA. If the update authority were
                // the PDA, correcting a typo in the name or pointing the URI at
                // a real logo would need another program instruction and another
                // redeploy; with the admin it is an ordinary Metaplex update.
                update_authority: ctx.accounts.admin.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                // Required by the struct in anchor-spl 0.31.1 even though it is
                // never sent as an account meta.
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer,
        ),
        DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        true, // is_mutable — so the name and URI can be corrected later
        true, // update_authority_is_signer — the admin signs this transaction
        None, // collection_details — None: this is a fungible claim token
    )?;

    msg!(
        "Claim-token metadata created for vault {} mint {}",
        ctx.accounts.vault.vault_id,
        ctx.accounts.share_mint.key()
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CreateShareMetadata<'info> {
    // Not `mut`. Nothing about the vault changes, and saying so in the account
    // list means the runtime enforces it.
    #[account(
        has_one = admin @ VaultError::UnauthorizedAdmin,
        seeds = [b"vault", vault.admin.as_ref(), vault.vault_id.as_bytes()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(constraint = share_mint.key() == vault.share_mint)]
    pub share_mint: Account<'info, Mint>,

    /// CHECK: the Token Metadata PDA. Its seeds are verified here; the account
    /// itself is created and owned by Metaplex during the CPI.
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), share_mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub metadata: UncheckedAccount<'info>,

    // `has_one` above proves vault.admin == admin.key(); `Signer` proves the
    // signature. Both are needed — neither is an authorisation on its own.
    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
