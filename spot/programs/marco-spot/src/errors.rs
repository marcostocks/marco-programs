use anchor_lang::prelude::*;

#[error_code]
pub enum SpotError {
    #[msg("Market is not accepting new orders")]
    MarketNotActive,

    #[msg("Order is not in the required status for this operation")]
    InvalidOrderStatus,

    #[msg("Order side does not match this instruction")]
    WrongOrderSide,

    #[msg("Unauthorized — only admin can perform this action")]
    UnauthorizedAdmin,

    #[msg("Unauthorized — only admin or operator can perform this action")]
    UnauthorizedOperator,

    #[msg("Unauthorized — only the order's trader can perform this action")]
    UnauthorizedTrader,

    #[msg("Trader is not eligible to trade — identity verification required")]
    TraderNotEligible,

    #[msg("Order amount must be greater than zero")]
    ZeroAmount,

    #[msg("Order is below the market minimum")]
    BelowMinimum,

    #[msg("Order exceeds the market maximum")]
    AboveMaximum,

    #[msg("Insufficient position tokens for this order")]
    InsufficientShares,

    #[msg("Execution price is worse than the order's limit price")]
    LimitPriceExceeded,

    #[msg("Deploy destination does not match the market's immutable settlement account")]
    WrongDestination,

    #[msg("Deploy amount exceeds the escrowed balance for this order")]
    ExceedsEscrow,

    #[msg("Attested notional does not match the capital deployed for this order")]
    NotionalMismatch,

    #[msg("Fee sweep amount exceeds collected fees")]
    FeeSweepExceedsCollected,

    #[msg("Ticker is empty or longer than 16 characters")]
    InvalidTicker,

    #[msg("Fee exceeds the maximum allowed (5% = 500 bps)")]
    FeeTooHigh,

    #[msg("Invalid parameter supplied")]
    InvalidParameter,

    #[msg("Position tokens are still locked for this market")]
    TransferLockActive,

    #[msg("Custody attestation is missing required fields")]
    InvalidAttestation,

    #[msg("Arithmetic overflow")]
    Overflow,
}
