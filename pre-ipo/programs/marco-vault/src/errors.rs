use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Vault is not in the required phase for this operation")]
    InvalidPhase,

    #[msg("Subscription window is not open yet")]
    FundingNotStarted,

    #[msg("Subscription window has closed")]
    FundingClosed,

    #[msg("Deposits are currently frozen by admin")]
    DepositsFrozen,

    #[msg("Deposit amount must be greater than zero")]
    ZeroDeposit,

    #[msg("Deposit is below the minimum deposit for this vault")]
    BelowMinimum,

    #[msg("Address has reached its per-wallet deposit limit")]
    AddressLimitReached,

    #[msg("Vault deposit cap is full")]
    CapFull,

    #[msg("Unauthorized — only admin can perform this action")]
    UnauthorizedAdmin,

    #[msg("Unauthorized — only admin or operator can perform this action")]
    UnauthorizedOperator,

    #[msg("Deploy destination does not match the vault's immutable broker account")]
    WrongDestination,

    #[msg("Deploy amount exceeds the confirmed deployable allocation")]
    ExceedsDeployable,

    #[msg("Confirmed allocation exceeds subscribed capital")]
    AllocationExceedsDeposits,

    #[msg("Settlement amount must be greater than zero")]
    ZeroSettlement,

    #[msg("Redemption amount must be greater than zero")]
    ZeroRedemption,

    #[msg("Insufficient claim tokens for this action")]
    InsufficientShares,

    #[msg("No redeemable amount is set")]
    NoRedeemableAmount,

    #[msg("Fee sweep amount exceeds collected fees")]
    FeeSweepExceedsCollected,

    #[msg("Vault ID too long (max 64 characters)")]
    VaultIdTooLong,

    #[msg("Fee exceeds the maximum allowed (20% = 2000 bps)")]
    FeeTooHigh,

    #[msg("Unrefundable costs exceed subscribed capital")]
    UnrefundableExceedsDeposits,

    #[msg("Close-out date has not been reached yet")]
    CloseOutNotReached,

    #[msg("Invalid parameter supplied at initialization")]
    InvalidParameter,

    #[msg("Share-delivery election window is closed")]
    ElectionClosed,

    #[msg("Share-delivery election window is still open")]
    ElectionStillOpen,

    #[msg("Share allocation has not been recorded for this vault")]
    AllocationNotSet,

    #[msg("Claim tokens are still locked for this vault")]
    TransferLockActive,

    #[msg("Claim tokens are already unlocked for this vault")]
    TransferLockInactive,

    #[msg("Arithmetic overflow")]
    Overflow,
}
