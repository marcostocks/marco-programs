/**
 * Chart of accounts.
 *
 * The account set is closed. A typo cannot invent a new account, and a balance
 * cannot quietly land somewhere nobody reconciles.
 *
 * Sign convention: **debit positive**. Assets and expenses carry a positive
 * balance in normal operation; liabilities, equity and income carry a negative
 * one. Every journal entry must sum to zero *per currency*.
 */

export const CASH_ACCOUNTS = {
  /* ---- Assets ---------------------------------------------------------- */

  /** USDC sitting in an on-chain escrow PDA (spot market escrow, vault vault). */
  CHAIN_ESCROW: 'asset.chain.escrow',

  /** Value handed to the money services business, not yet converted. */
  MSB_TRANSIT: 'asset.msb.transit',

  /** Converted funds at the MSB awaiting payout to the broker. */
  MSB_SETTLED: 'asset.msb.settled',

  /** Pre-funded working balance at the broker. The hybrid model draws on this. */
  BROKER_BUFFER: 'asset.broker.buffer',

  /** Broker cash earmarked against a placed order, not yet settled. */
  BROKER_SETTLEMENT: 'asset.broker.settlement',

  /** Sale proceeds sitting at the broker awaiting repatriation. */
  BROKER_PROCEEDS: 'asset.broker.proceeds',

  /** Our own USDC float, used to pay sellers before repatriation lands. */
  TREASURY_USDC: 'asset.treasury.usdc',

  /**
   * Spread earned in-contract and still sitting on-chain in `fees_collected`,
   * awaiting `sweep_fee`. Earned is not the same as swept, and the program
   * bounds a sweep to earned-minus-swept, so the two are tracked separately.
   */
  CHAIN_FEES_RECEIVABLE: 'asset.chain.fees_receivable',

  /* ---- Liabilities ----------------------------------------------------- */

  /** Owed to a trader whose USDC is escrowed against an open buy. */
  CUSTOMER_ESCROW: 'liability.customer.escrow',

  /** Owed to a trader whose sale has filled but not yet paid out on-chain. */
  CUSTOMER_PROCEEDS: 'liability.customer.proceeds',

  /** Owed to vault subscribers — principal held pending deployment or refund. */
  VAULT_SUBSCRIPTION: 'liability.vault.subscription',

  /** Vault net settlement proceeds recorded on-chain and awaiting redemption. */
  VAULT_REDEEMABLE: 'liability.vault.redeemable',

  /* ---- Income and expense ---------------------------------------------- */

  /** Spread earned in-contract at deploy_buy / settle_sell, and the vault fee. */
  INCOME_SPREAD: 'income.spread',

  /** Realised gain or loss on the USDC/HKD crossing. */
  INCOME_FX: 'income.fx',

  EXPENSE_BROKER_COMMISSION: 'expense.broker.commission',
  /** HK stamp duty, SFC transaction levy, HKEX trading fee. */
  EXPENSE_EXCHANGE_LEVIES: 'expense.exchange.levies',
  EXPENSE_MSB_FEE: 'expense.msb.fee',
  EXPENSE_CUSTODY_FEE: 'expense.custody.fee',
  EXPENSE_CHAIN_FEE: 'expense.chain.fee',

  /* ---- Clearing -------------------------------------------------------- */

  /**
   * FX crossing account. A conversion posts both legs through here so each
   * currency balances independently: USDC out of transit into FX_CLEARING,
   * HKD out of FX_CLEARING into the broker buffer. The residual balance on
   * this account, revalued, *is* the FX P&L.
   */
  FX_CLEARING: 'clearing.fx',

  /**
   * Where a reconciliation break is parked until a human resolves it. A
   * non-zero balance here is an operational alarm, never a normal state.
   */
  SUSPENSE: 'clearing.suspense',
} as const;

export type CashAccount = (typeof CASH_ACCOUNTS)[keyof typeof CASH_ACCOUNTS];

export const ALL_CASH_ACCOUNTS = Object.values(CASH_ACCOUNTS) as CashAccount[];

/** Accounts whose normal balance is a debit (positive). */
const DEBIT_NORMAL = new Set<string>([
  CASH_ACCOUNTS.CHAIN_ESCROW,
  CASH_ACCOUNTS.MSB_TRANSIT,
  CASH_ACCOUNTS.MSB_SETTLED,
  CASH_ACCOUNTS.BROKER_BUFFER,
  CASH_ACCOUNTS.BROKER_SETTLEMENT,
  CASH_ACCOUNTS.BROKER_PROCEEDS,
  CASH_ACCOUNTS.TREASURY_USDC,
  CASH_ACCOUNTS.CHAIN_FEES_RECEIVABLE,
  CASH_ACCOUNTS.EXPENSE_BROKER_COMMISSION,
  CASH_ACCOUNTS.EXPENSE_EXCHANGE_LEVIES,
  CASH_ACCOUNTS.EXPENSE_MSB_FEE,
  CASH_ACCOUNTS.EXPENSE_CUSTODY_FEE,
  CASH_ACCOUNTS.EXPENSE_CHAIN_FEE,
]);

export function isDebitNormal(account: CashAccount): boolean {
  return DEBIT_NORMAL.has(account);
}

/* -------------------------------------------------------------------------- */
/* Position accounts                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Share units are tracked in a parallel ledger, because units and cash do not
 * belong in the same balance. The invariant this ledger exists to prove is:
 *
 *     shares held by the custodian  ==  position tokens outstanding on Solana
 *
 * which is exactly the "backed 1:1" claim in the product documentation.
 */
export const POSITION_ACCOUNTS = {
  /** Shares confirmed settled into the custodian's segregated account. */
  CUSTODY_HOLDINGS: 'asset.custody.holdings',

  /** Bought and filled at the broker, not yet settled into custody (T+2). */
  CUSTODY_INBOUND: 'asset.custody.inbound',

  /** Sold at the broker, not yet released out of custody. */
  CUSTODY_OUTBOUND: 'asset.custody.outbound',

  /** Shares owed to on-chain position-token holders. Mirrors token supply. */
  CUSTOMER_POSITIONS: 'liability.customer.positions',

  /**
   * Shares bought and owed to a trader, but not yet minted on-chain.
   *
   * This account exists so `CUSTOMER_POSITIONS` can mirror token supply
   * *exactly* — the invariant reconciliation checks. Between the broker fill
   * and `confirm_buy`, the obligation is real but no token exists yet, and it
   * parks here.
   */
  PENDING_ISSUANCE: 'liability.customer.pending_issuance',

  /** Shares a vault holder elected to take by delivery, pending transfer out. */
  DELIVERY_PENDING: 'liability.customer.delivery',

  /** Break parking for the position ledger. Non-zero is an alarm. */
  SUSPENSE: 'clearing.position_suspense',
} as const;

export type PositionAccount = (typeof POSITION_ACCOUNTS)[keyof typeof POSITION_ACCOUNTS];

export const ALL_POSITION_ACCOUNTS = Object.values(POSITION_ACCOUNTS) as PositionAccount[];
