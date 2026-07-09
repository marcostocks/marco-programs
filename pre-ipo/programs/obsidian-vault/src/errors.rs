use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Vault is not in the required phase for this operation")]
    InvalidPhase,

    #[msg("Deposit window has closed")]
    DepositWindowClosed,

    #[msg("Vault deposit cap has been reached")]
    DepositCapReached,

    #[msg("Deposits are currently frozen by admin")]
    DepositsFrozen,

    #[msg("Deposit amount must be greater than zero")]
    ZeroDeposit,

    #[msg("Deposit would exceed vault cap")]
    DepositExceedsCap,

    #[msg("Unauthorized — only admin can perform this action")]
    UnauthorizedAdmin,

    #[msg("Unauthorized — only admin or operator can perform this action")]
    UnauthorizedOperator,

    #[msg("Move amount exceeds unreserved vault balance")]
    MoveExceedsBalance,

    #[msg("Settlement amount must be greater than zero")]
    ZeroSettlement,

    #[msg("Redemption amount must be greater than zero")]
    ZeroRedemption,

    #[msg("Insufficient shares for redemption")]
    InsufficientShares,

    #[msg("No redeemable amount set")]
    NoRedeemableAmount,

    #[msg("Fee sweep amount exceeds collected fees")]
    FeeSweepExceedsCollected,

    #[msg("Vault ID too long (max 64 characters)")]
    VaultIdTooLong,

    #[msg("Sourcing spread exceeds maximum (20% = 2000 bps)")]
    SourcingSpreadTooHigh,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Redeemable amount exceeds vault USDC balance")]
    RedeemableExceedsBalance,

    #[msg("Cannot move assets — would drain funds reserved for yield or fees")]
    MoveWouldDrainReserved,
}
