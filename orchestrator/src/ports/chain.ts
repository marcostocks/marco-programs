/**
 * Solana gateway port.
 *
 * Mirrors the operator-callable surface of the two Anchor programs:
 *
 *   marco-spot   place_buy → deploy_buy → confirm_buy → Filled
 *                place_sell → settle_sell → Settled
 *   marco-vault  open_funding → … → deploy_capital → mark_listed → settle → …
 *
 * Neither program can advance without this service. Every write here is
 * **idempotent by on-chain state**: the adapter reads the account first and
 * returns a no-op result if the transition has already landed. Blind
 * resubmission of a money-moving instruction is never acceptable, because a
 * transaction that appeared to time out may still confirm.
 */

import type { Money, Quantity } from '../domain/money.js';

export interface ChainTxResult {
  readonly signature: string;
  readonly slot: number;
  readonly confirmedAt: string;
  /** True when on-chain state already satisfied the transition. */
  readonly alreadyApplied: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export type MarketStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED';

export interface SpotMarket {
  readonly ticker: string;
  readonly marketAddress: string;
  readonly positionMint: string;
  /** USDC held in the market escrow PDA. */
  readonly escrowBalance: Money;
  /** Position tokens outstanding. The number recon compares against custody. */
  readonly positionSupply: Quantity;
  readonly status: MarketStatus;
  readonly feeBps: number;
  /** Immutable conversion-partner destination fixed at market creation. */
  readonly settlementDestination: string;
  readonly feesCollected: Money;
  readonly feesSwept: Money;
}

export type SpotOrderState =
  | 'PENDING'
  | 'DEPLOYED'
  | 'FILLED'
  | 'SETTLED'
  | 'CANCELLED';

export interface SpotOrder {
  readonly orderId: string;
  readonly orderAddress: string;
  readonly ticker: string;
  readonly side: 'BUY' | 'SELL';
  readonly trader: string;
  readonly state: SpotOrderState;
  /** Buy: USDC escrowed. Sell: null. */
  readonly escrowedAmount: Money | null;
  /** Sell: position tokens escrowed. Buy: null. */
  readonly escrowedShares: Quantity | null;
  /** Per-share limit the trader agreed to, in HKD. */
  readonly limitPrice: Money;
  readonly requestedQuantity: Quantity;
  readonly createdAtSlot: number;
  /** Populated once confirm_buy has attested. */
  readonly custodyReference: string | null;
  readonly documentHash: string | null;
}

export interface TraderAccount {
  readonly wallet: string;
  readonly eligible: boolean;
  /** ISO 3166-1 numeric code the verification was performed under. 0 if unset. */
  readonly jurisdiction: number;
  readonly registeredAtSlot: number;
}

export type VaultPhase =
  | 'Scheduled'
  | 'Funding'
  | 'Sealed'
  | 'Sourcing'
  | 'Sourced'
  | 'Deployed'
  | 'Live'
  | 'Realized'
  | 'Claimable'
  | 'Winding'
  | 'Concluded'
  | 'Cancelled'
  | 'Refunded';

export interface VaultState {
  readonly vaultId: string;
  readonly vaultAddress: string;
  readonly claimMint: string;
  readonly phase: VaultPhase;
  readonly cap: Money;
  readonly totalDeposits: Money;
  /** Claim tokens outstanding — net of the upfront fee, so ≠ totalDeposits. */
  readonly totalShares: bigint;
  readonly usdcBalance: Money;
  readonly feeBps: number;
  /**
   * When the protocol fee is charged. `false` takes it at deposit and mints the
   * net; `true` mints the gross 1:1 and takes it out of the redemption instead.
   * Fixed for the life of the vault once anyone has deposited.
   */
  readonly feeAtExit: boolean;
  readonly feesEscrowed: Money;
  readonly feesCollected: Money;
  readonly feesSwept: Money;
  /** Immutable broker destination fixed at vault creation. */
  readonly brokerDestination: string;
  readonly deployableAmount: Money | null;
  readonly deployedAmount: Money;
  readonly sharesAllocated: Quantity | null;
  readonly deliveredShares: bigint;
  readonly redeemableAmount: Money | null;
  readonly electionDeadline: string | null;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export type ChainEventKind =
  | 'spot.buy_placed'
  | 'spot.buy_cancelled'
  | 'spot.sell_placed'
  | 'spot.sell_cancelled'
  | 'vault.deposit'
  | 'vault.claim'
  | 'vault.refund'
  | 'vault.delivery_elected';

export interface ChainEvent {
  readonly kind: ChainEventKind;
  readonly signature: string;
  readonly slot: number;
  readonly occurredAt: string;
  readonly wallet: string;
  readonly ticker?: string;
  readonly orderId?: string;
  readonly vaultId?: string;
  readonly amount?: Money;
  readonly shares?: Quantity;
  /**
   * Per-share limit the trader agreed to, read from the order account rather
   * than the log. Present on spot order events.
   */
  readonly limitPrice?: Money;
}

/**
 * A durable position in the event stream. Polling with a persisted cursor
 * survives a restart; a websocket subscription does not, and a missed
 * `place_buy` is a trader whose USDC sits escrowed forever.
 */
export interface ChainCursor {
  readonly lastSignature: string | null;
  readonly lastSlot: number;
}

export interface ChainEventPage {
  readonly events: readonly ChainEvent[];
  readonly cursor: ChainCursor;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface ConfirmBuyAttestation {
  readonly orderId: string;
  readonly ticker: string;
  /** Shares actually acquired. May be less than requested on a partial fill. */
  readonly quantity: Quantity;
  /** Weighted average fill price. Must not be worse than the trader's limit. */
  readonly averagePrice: Money;
  /** Custodian's position reference. Must be non-zero or the program rejects. */
  readonly custodyReference: string;
  /** 32-byte hex digest of the settlement document. Must be non-zero. */
  readonly documentHash: string;
}

export interface SettleSellInstruction {
  readonly orderId: string;
  readonly ticker: string;
  /** Gross USDC proceeds. The program deducts the spread and pays the net. */
  readonly grossProceeds: Money;
  readonly quantity: Quantity;
  /**
   * Weighted average execution price per share. The program rejects a sale
   * below the seller's limit, so this is not advisory.
   */
  readonly executionPrice: Money;
  /**
   * 32-byte hex digest of the sale's settlement document. Must be non-zero —
   * the program refuses to settle a sell that nothing evidences, exactly as
   * `confirm_buy` refuses to mint against an unevidenced purchase.
   */
  readonly documentHash: string;
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

export interface InitializeMarketParams {
  readonly ticker: string;
  readonly shareDecimals: number;
  readonly feeBps: number;
  readonly minOrderUsdc: Money;
  readonly maxOrderUsdc: Money;
  /**
   * The conversion partner's USDC account. Fixed here forever — deployment can
   * never be pointed anywhere else — so a wrong value is unrecoverable.
   */
  readonly settlementDestination: string;
  readonly treasury: string;
}

export interface InitializeVaultParams {
  readonly vaultId: string;
  readonly depositCap: Money;
  readonly minDeposit: Money;
  /** Zero means no per-address ceiling. */
  readonly maxDeposit: Money;
  readonly fundingStart: string;
  readonly fundingDeadline: string;
  readonly closeOutAt: string;
  readonly feeBps: number;
  /** The broker's USDC account. Fixed here forever, as above. */
  readonly depositDestination: string;
  readonly treasury: string;
}

/**
 * One wallet's running position in a market, as the program has recorded it.
 *
 * These are cumulative counters rather than a snapshot balance, which is what
 * makes a cost basis possible: the token account says how many shares are held
 * now, but only `usdcSpent` against `sharesBought` says what they cost.
 */
export interface SpotHolding {
  readonly ticker: string;
  readonly wallet: string;
  readonly sharesBought: Quantity;
  readonly sharesSold: Quantity;
  /** Bought less sold — what the holder still has. */
  readonly openQuantity: Quantity;
  readonly usdcSpent: Money;
  readonly usdcReceived: Money;
  readonly feesPaid: Money;
  /** Spent per share bought. Null before the first fill, never a divide by zero. */
  readonly averageCost: Money | null;
  /** Received less spent. Meaningful once the position is fully closed. */
  readonly realisedPnl: Money;
}

/** One wallet's position in a vault, from its `BuyerState`. */
export interface VaultPosition {
  readonly vaultId: string;
  readonly wallet: string;
  readonly depositAmount: Money;
  readonly sharesMinted: bigint;
  readonly sharesRedeemed: bigint;
  readonly sharesDelivered: bigint;
  /** Minted less redeemed less delivered — the claim still outstanding. */
  readonly openShares: bigint;
  readonly usdcRedeemed: Money;
  readonly usdcRefunded: Money;
  /** Zero on an exit-fee vault, where the fee comes off the redemption. */
  readonly entryFeePaid: Money;
}

export interface ChainGateway {
  readonly id: string;

  /* ---- Reads ---------------------------------------------------------- */
  getMarket(ticker: string): Promise<SpotMarket | null>;
  getSpotOrder(ticker: string, orderId: string): Promise<SpotOrder | null>;
  getTraderAccount(wallet: string): Promise<TraderAccount | null>;
  getVault(vaultId: string): Promise<VaultState | null>;
  pollEvents(cursor: ChainCursor, limit: number): Promise<ChainEventPage>;

  /**
   * Every market and vault the programs hold, read from chain rather than from
   * a registry. There is no list of tradeable assets anywhere off-chain, and a
   * registry would be one more thing to drift out of date.
   */
  listMarkets(): Promise<SpotMarket[]>;
  listVaults(): Promise<VaultState[]>;

  /** Null when this wallet has never traded that market / subscribed to that vault. */
  getHolding(ticker: string, wallet: string): Promise<SpotHolding | null>;
  getVaultPosition(vaultId: string, wallet: string): Promise<VaultPosition | null>;

  /* ---- Creation -------------------------------------------------------- */

  /**
   * Create a market and its position mint. The settlement destination fixed
   * here is immutable, so this is the one call whose arguments can never be
   * corrected afterwards.
   */
  initializeMarket(params: InitializeMarketParams): Promise<ChainTxResult>;

  /** Create a vault and its claim mint. The broker destination is immutable. */
  initializeVault(params: InitializeVaultParams): Promise<ChainTxResult>;

  /* ---- marco-spot writes ---------------------------------------------- */

  /** Sends escrowed USDC to the immutable conversion-partner account. */
  deployBuy(ticker: string, orderId: string): Promise<ChainTxResult>;

  /** The only mint path. Requires a non-zero custody ref and document hash. */
  confirmBuy(attestation: ConfirmBuyAttestation): Promise<ChainTxResult>;

  cancelBuy(ticker: string, orderId: string, reason: string): Promise<ChainTxResult>;

  /** Burns the escrowed position tokens and pays proceeds net of spread. */
  settleSell(instruction: SettleSellInstruction): Promise<ChainTxResult>;

  cancelSell(ticker: string, orderId: string, reason: string): Promise<ChainTxResult>;

  setMarketStatus(ticker: string, status: MarketStatus): Promise<ChainTxResult>;

  /**
   * Record eligibility after off-chain identity verification.
   *
   * `jurisdiction` is an **ISO 3166-1 numeric** country code (344 = Hong Kong,
   * 826 = United Kingdom), not an alpha-2 string — the program stores it as a
   * `u16`. The program performs no KYC; it records the outcome, and
   * `place_buy`/`place_sell` read the flag.
   */
  registerTrader(wallet: string, jurisdiction: number): Promise<ChainTxResult>;

  revokeTrader(wallet: string): Promise<ChainTxResult>;

  /* ---- marco-vault writes --------------------------------------------- */
  openFunding(vaultId: string): Promise<ChainTxResult>;
  sealFunding(vaultId: string): Promise<ChainTxResult>;
  beginSourcing(vaultId: string): Promise<ChainTxResult>;
  confirmAllocation(vaultId: string, deployable: Money): Promise<ChainTxResult>;
  deployCapital(vaultId: string, amount: Money): Promise<ChainTxResult>;
  markListed(
    vaultId: string,
    sharesAllocated: Quantity,
    electionPeriodSeconds: number,
  ): Promise<ChainTxResult>;
  markRealized(vaultId: string, grossProceeds: Money): Promise<ChainTxResult>;
  settleVault(vaultId: string, netCash: Money): Promise<ChainTxResult>;
  windDown(vaultId: string): Promise<ChainTxResult>;
  concludeVault(vaultId: string): Promise<ChainTxResult>;
  cancelVault(vaultId: string, unrefundableCosts: Money): Promise<ChainTxResult>;
  sweepFee(vaultId: string, amount: Money): Promise<ChainTxResult>;
  freezeDeposits(vaultId: string, frozen: boolean): Promise<ChainTxResult>;
  /**
   * Move the protocol fee to redemption (mint gross 1:1) or back to deposit
   * (mint net). The program accepts this only before the first deposit — after
   * that the ratio is already baked into everyone's claim tokens and changing
   * it would charge them twice.
   */
  setFeeTiming(vaultId: string, atExit: boolean): Promise<ChainTxResult>;
}
