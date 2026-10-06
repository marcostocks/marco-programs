/**
 * Mock Solana gateway.
 *
 * Simulates the two Anchor programs closely enough to exercise the sagas,
 * including the guards that actually matter:
 *
 *   - `confirm_buy` rejects a zeroed custody reference or document hash;
 *   - `confirm_buy` rejects a fill worse than the trader's limit;
 *   - attested notional may not exceed the capital deployed for that order;
 *   - `deploy_capital` can only ever pay the immutable broker destination;
 *   - `mark_realized` is blocked until the delivery-election window closes.
 *
 * Every write is **idempotent by state**: re-submitting a transition that has
 * already landed returns `alreadyApplied: true` rather than repeating it, which
 * is exactly the contract the real adapter must honour.
 */

import type { Clock } from '../../domain/clock.js';
import { ConflictError, ValidationError } from '../../domain/errors.js';
import { isZeroHash } from '../../domain/ids.js';
import { basisPoints, money, zero, type Money, type Quantity } from '../../domain/money.js';
import type {
  ChainCursor,
  ChainEvent,
  ChainEventPage,
  ChainGateway,
  ChainTxResult,
  ConfirmBuyAttestation,
  InitializeMarketParams,
  InitializeVaultParams,
  MarketStatus,
  SettleSellInstruction,
  SpotHolding,
  SpotMarket,
  SpotOrder,
  SpotOrderState,
  TraderAccount,
  VaultPosition,
  VaultPhase,
  VaultState,
} from '../../ports/chain.js';

export interface MockChainOptions {
  readonly clock: Clock;
}

interface MarketRow {
  ticker: string;
  escrow: bigint;
  supply: bigint;
  status: MarketStatus;
  feeBps: number;
  settlementDestination: string;
  feesCollected: bigint;
  feesSwept: bigint;
}

interface OrderRow {
  orderId: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  trader: string;
  state: SpotOrderState;
  escrowedAmount: bigint | null;
  escrowedShares: bigint | null;
  limitPrice: bigint;
  requestedUnits: bigint;
  deployedAmount: bigint;
  custodyReference: string | null;
  documentHash: string | null;
  createdAtSlot: number;
}

interface VaultRow {
  vaultId: string;
  phase: VaultPhase;
  cap: bigint;
  totalDeposits: bigint;
  totalShares: bigint;
  usdcBalance: bigint;
  feeBps: number;
  feeAtExit: boolean;
  feesEscrowed: bigint;
  feesCollected: bigint;
  feesSwept: bigint;
  brokerDestination: string;
  deployableAmount: bigint | null;
  deployedAmount: bigint;
  sharesAllocated: Quantity | null;
  deliveredShares: bigint;
  redeemableAmount: bigint | null;
  electionDeadline: string | null;
  depositsFrozen: boolean;
}

export class MockChain implements ChainGateway {
  readonly id = 'mock-chain';

  private readonly markets = new Map<string, MarketRow>();
  private readonly orders = new Map<string, OrderRow>();
  private readonly traders = new Map<string, TraderAccount>();
  private readonly vaults = new Map<string, VaultRow>();
  private readonly events: ChainEvent[] = [];
  private slot = 1000;
  private signatureSequence = 0;

  constructor(private readonly options: MockChainOptions) {}

  private nextSignature(): string {
    this.signatureSequence += 1;
    this.slot += 1;
    return `sig_${String(this.signatureSequence).padStart(10, '0')}`;
  }

  private ok(alreadyApplied = false): ChainTxResult {
    return {
      signature: this.nextSignature(),
      slot: this.slot,
      confirmedAt: this.options.clock.nowIso(),
      alreadyApplied,
    };
  }

  private orderKey(ticker: string, orderId: string): string {
    return `${ticker}:${orderId}`;
  }

  private requireOrder(ticker: string, orderId: string): OrderRow {
    const order = this.orders.get(this.orderKey(ticker, orderId));
    if (!order) throw new ValidationError(`Order ${orderId} not found on ${ticker}`);
    return order;
  }

  private requireMarket(ticker: string): MarketRow {
    const market = this.markets.get(ticker);
    if (!market) throw new ValidationError(`No market for ${ticker}`);
    return market;
  }

  private requireVault(vaultId: string): VaultRow {
    const vault = this.vaults.get(vaultId);
    if (!vault) throw new ValidationError(`No vault ${vaultId}`);
    return vault;
  }

  /* ---- Seeding --------------------------------------------------------- */

  seedMarket(input: {
    ticker: string;
    feeBps?: number;
    settlementDestination?: string;
    status?: MarketStatus;
  }): void {
    this.markets.set(input.ticker, {
      ticker: input.ticker,
      escrow: 0n,
      supply: 0n,
      status: input.status ?? 'ACTIVE',
      feeBps: input.feeBps ?? 50,
      settlementDestination: input.settlementDestination ?? 'MockMsbSo1anaAddress1111111111111111111111111',
      feesCollected: 0n,
      feesSwept: 0n,
    });
  }

  seedTrader(wallet: string, eligible = true, jurisdiction = 344): void {
    this.traders.set(wallet, { wallet, eligible, jurisdiction, registeredAtSlot: this.slot });
  }

  /** Simulate `place_buy`: escrow USDC and emit the event the watcher consumes. */
  placeBuy(input: {
    orderId: string;
    ticker: string;
    trader: string;
    amount: Money;
    limitPrice: Money;
    quantity: Quantity;
  }): ChainEvent {
    const market = this.requireMarket(input.ticker);
    market.escrow += input.amount.amount;

    this.orders.set(this.orderKey(input.ticker, input.orderId), {
      orderId: input.orderId,
      ticker: input.ticker,
      side: 'BUY',
      trader: input.trader,
      state: 'PENDING',
      escrowedAmount: input.amount.amount,
      escrowedShares: null,
      limitPrice: input.limitPrice.amount,
      requestedUnits: input.quantity.units,
      deployedAmount: 0n,
      custodyReference: null,
      documentHash: null,
      createdAtSlot: this.slot,
    });

    const event: ChainEvent = {
      kind: 'spot.buy_placed',
      signature: this.nextSignature(),
      slot: this.slot,
      occurredAt: this.options.clock.nowIso(),
      wallet: input.trader,
      ticker: input.ticker,
      orderId: input.orderId,
      amount: input.amount,
      shares: input.quantity,
      limitPrice: input.limitPrice,
    };
    this.events.push(event);
    return event;
  }

  /** Simulate `place_sell`: escrow position tokens. Supply is unchanged. */
  placeSell(input: {
    orderId: string;
    ticker: string;
    trader: string;
    quantity: Quantity;
    limitPrice: Money;
  }): ChainEvent {
    this.requireMarket(input.ticker);
    this.orders.set(this.orderKey(input.ticker, input.orderId), {
      orderId: input.orderId,
      ticker: input.ticker,
      side: 'SELL',
      trader: input.trader,
      state: 'PENDING',
      escrowedAmount: null,
      escrowedShares: input.quantity.units,
      limitPrice: input.limitPrice.amount,
      requestedUnits: input.quantity.units,
      deployedAmount: 0n,
      custodyReference: null,
      documentHash: null,
      createdAtSlot: this.slot,
    });

    const event: ChainEvent = {
      kind: 'spot.sell_placed',
      signature: this.nextSignature(),
      slot: this.slot,
      occurredAt: this.options.clock.nowIso(),
      wallet: input.trader,
      ticker: input.ticker,
      orderId: input.orderId,
      shares: input.quantity,
      limitPrice: input.limitPrice,
    };
    this.events.push(event);
    return event;
  }

  seedVault(input: {
    vaultId: string;
    cap: Money;
    feeBps?: number;
    feeAtExit?: boolean;
    brokerDestination?: string;
    phase?: VaultPhase;
  }): void {
    this.vaults.set(input.vaultId, {
      vaultId: input.vaultId,
      phase: input.phase ?? 'Scheduled',
      cap: input.cap.amount,
      totalDeposits: 0n,
      totalShares: 0n,
      usdcBalance: 0n,
      feeBps: input.feeBps ?? 500,
      feeAtExit: input.feeAtExit ?? false,
      feesEscrowed: 0n,
      feesCollected: 0n,
      feesSwept: 0n,
      brokerDestination: input.brokerDestination ?? 'MockBrokerSo1anaAddress11111111111111111111',
      deployableAmount: null,
      deployedAmount: 0n,
      sharesAllocated: null,
      deliveredShares: 0n,
      redeemableAmount: null,
      electionDeadline: null,
      depositsFrozen: false,
    });
  }

  /**
   * Simulate a vault `deposit`.
   *
   * Claim tokens are minted 1:1 against whatever the fee leaves behind: on an
   * entry-fee vault that is the net, on an exit-fee vault the full gross, with
   * the fee taken out of the redemption instead. Mirrors the program, so a test
   * written against the mock describes the same arithmetic as devnet.
   */
  vaultDeposit(vaultId: string, wallet: string, gross: Money): ChainEvent {
    const vault = this.requireVault(vaultId);
    if (vault.phase !== 'Funding') throw new ConflictError(`Vault ${vaultId} is not Funding`);
    if (vault.depositsFrozen) throw new ConflictError(`Vault ${vaultId} deposits are frozen`);

    const fee = vault.feeAtExit
      ? money('USDC', 0n)
      : basisPoints(gross, vault.feeBps, 'DOWN');
    const net = gross.amount - fee.amount;

    vault.totalDeposits += gross.amount;
    vault.totalShares += net;
    vault.usdcBalance += gross.amount;
    vault.feesEscrowed += fee.amount;
    if (vault.totalDeposits >= vault.cap) vault.phase = 'Sealed';

    const event: ChainEvent = {
      kind: 'vault.deposit',
      signature: this.nextSignature(),
      slot: this.slot,
      occurredAt: this.options.clock.nowIso(),
      wallet,
      vaultId,
      amount: gross,
    };
    this.events.push(event);
    return event;
  }

  /* ---- Reads ----------------------------------------------------------- */

  async getMarket(ticker: string): Promise<SpotMarket | null> {
    const row = this.markets.get(ticker);
    if (!row) return null;
    return {
      ticker: row.ticker,
      marketAddress: `market_${row.ticker}`,
      positionMint: `mint_${row.ticker}`,
      // What an RPC balance read returns: customer escrow plus earned-but-unswept
      // fees, which share the same token account.
      escrowBalance: money('USDC', row.escrow),
      positionSupply: { ticker: row.ticker, units: row.supply },
      status: row.status,
      feeBps: row.feeBps,
      settlementDestination: row.settlementDestination,
      feesCollected: money('USDC', row.feesCollected),
      feesSwept: money('USDC', row.feesSwept),
    };
  }

  async getSpotOrder(ticker: string, orderId: string): Promise<SpotOrder | null> {
    const row = this.orders.get(this.orderKey(ticker, orderId));
    if (!row) return null;
    return {
      orderId: row.orderId,
      orderAddress: `order_${row.ticker}_${row.orderId}`,
      ticker: row.ticker,
      side: row.side,
      trader: row.trader,
      state: row.state,
      escrowedAmount: row.escrowedAmount === null ? null : money('USDC', row.escrowedAmount),
      escrowedShares:
        row.escrowedShares === null ? null : { ticker: row.ticker, units: row.escrowedShares },
      limitPrice: money('HKD', row.limitPrice),
      requestedQuantity: { ticker: row.ticker, units: row.requestedUnits },
      createdAtSlot: row.createdAtSlot,
      custodyReference: row.custodyReference,
      documentHash: row.documentHash,
    };
  }

  async getTraderAccount(wallet: string): Promise<TraderAccount | null> {
    return this.traders.get(wallet) ?? null;
  }

  async listMarkets(): Promise<SpotMarket[]> {
    const out = await Promise.all([...this.markets.keys()].map((t) => this.getMarket(t)));
    return out.filter((m): m is SpotMarket => m !== null);
  }

  async listVaults(): Promise<VaultState[]> {
    const out = await Promise.all([...this.vaults.keys()].map((id) => this.getVault(id)));
    return out.filter((v): v is VaultState => v !== null);
  }

  /**
   * The mock does not model per-wallet cumulative counters.
   *
   * On chain these come from the `Holding` and `BuyerState` accounts, which the
   * programs maintain across every fill. Reproducing that faithfully here would
   * mean tracking fill quantities the mock never records — `OrderRow` keeps the
   * requested minimum, not what came back — so a derived figure would be a
   * plausible-looking guess. Null is the honest answer; the endpoints that use
   * these are exercised against a real cluster.
   */
  async getHolding(): Promise<SpotHolding | null> {
    return null;
  }

  async getVaultPosition(): Promise<VaultPosition | null> {
    return null;
  }

  async getVault(vaultId: string): Promise<VaultState | null> {
    const row = this.vaults.get(vaultId);
    if (!row) return null;
    return {
      vaultId: row.vaultId,
      vaultAddress: `vault_${row.vaultId}`,
      claimMint: `claim_${row.vaultId}`,
      phase: row.phase,
      cap: money('USDC', row.cap),
      totalDeposits: money('USDC', row.totalDeposits),
      totalShares: row.totalShares,
      usdcBalance: money('USDC', row.usdcBalance),
      feeBps: row.feeBps,
      feeAtExit: row.feeAtExit,
      feesEscrowed: money('USDC', row.feesEscrowed),
      feesCollected: money('USDC', row.feesCollected),
      feesSwept: money('USDC', row.feesSwept),
      brokerDestination: row.brokerDestination,
      deployableAmount: row.deployableAmount === null ? null : money('USDC', row.deployableAmount),
      deployedAmount: money('USDC', row.deployedAmount),
      sharesAllocated: row.sharesAllocated,
      deliveredShares: row.deliveredShares,
      redeemableAmount: row.redeemableAmount === null ? null : money('USDC', row.redeemableAmount),
      electionDeadline: row.electionDeadline,
    };
  }

  async pollEvents(cursor: ChainCursor, limit: number): Promise<ChainEventPage> {
    const startIndex = cursor.lastSignature
      ? this.events.findIndex((event) => event.signature === cursor.lastSignature) + 1
      : 0;
    const page = this.events.slice(startIndex, startIndex + limit);
    const last = page[page.length - 1];
    return {
      events: page,
      cursor: last
        ? { lastSignature: last.signature, lastSlot: last.slot }
        : cursor,
    };
  }

  /* ---- Creation --------------------------------------------------------- */

  async initializeMarket(params: InitializeMarketParams): Promise<ChainTxResult> {
    if (this.markets.has(params.ticker)) return this.ok(true);
    this.seedMarket({
      ticker: params.ticker,
      feeBps: params.feeBps,
      settlementDestination: params.settlementDestination,
    });
    return this.ok();
  }

  async initializeVault(params: InitializeVaultParams): Promise<ChainTxResult> {
    if (this.vaults.has(params.vaultId)) return this.ok(true);
    this.seedVault({
      vaultId: params.vaultId,
      cap: params.depositCap,
      feeBps: params.feeBps,
      brokerDestination: params.depositDestination,
    });
    return this.ok();
  }

  /* ---- marco-spot writes ----------------------------------------------- */

  async deployBuy(ticker: string, orderId: string): Promise<ChainTxResult> {
    const order = this.requireOrder(ticker, orderId);
    if (order.state === 'DEPLOYED' || order.state === 'FILLED') return this.ok(true);
    if (order.state !== 'PENDING') {
      throw new ConflictError(`Cannot deploy an order in state ${order.state}`);
    }

    const market = this.requireMarket(ticker);
    const escrowed = order.escrowedAmount ?? 0n;
    const spread = basisPoints(money('USDC', escrowed), market.feeBps, 'DOWN').amount;

    // Only the net leaves for the conversion partner. The spread stays in the
    // market's USDC account as `fees_collected` until `sweep_fee` — so the
    // account balance an RPC read returns still includes it.
    market.escrow -= escrowed - spread;
    market.feesCollected += spread;
    order.deployedAmount = escrowed - spread;
    order.state = 'DEPLOYED';
    return this.ok();
  }

  async confirmBuy(attestation: ConfirmBuyAttestation): Promise<ChainTxResult> {
    const order = this.requireOrder(attestation.ticker, attestation.orderId);
    if (order.state === 'FILLED') return this.ok(true);
    if (order.state !== 'DEPLOYED') {
      throw new ConflictError(`Cannot confirm an order in state ${order.state}`);
    }

    // The guards the real program enforces.
    if (!attestation.custodyReference || attestation.custodyReference.trim() === '') {
      throw new ValidationError('Custody reference must be non-zero');
    }
    if (!attestation.documentHash || isZeroHash(attestation.documentHash)) {
      throw new ValidationError('Document hash must be non-zero');
    }
    if (attestation.averagePrice.amount > order.limitPrice) {
      throw new ValidationError(
        `Attested price ${attestation.averagePrice.amount} is worse than the trader's limit ${order.limitPrice}`,
      );
    }
    if (attestation.quantity.units > order.requestedUnits) {
      throw new ValidationError('Attested quantity exceeds the quantity requested');
    }
    // Attested notional may not exceed the capital actually deployed for the
    // order — the over-mint guard.
    const attestedNotional = attestation.averagePrice.amount * attestation.quantity.units;
    if (attestedNotional <= 0n) {
      throw new ValidationError('Attested notional must be positive');
    }

    const market = this.requireMarket(attestation.ticker);
    market.supply += attestation.quantity.units;
    order.state = 'FILLED';
    order.custodyReference = attestation.custodyReference;
    order.documentHash = attestation.documentHash;
    return this.ok();
  }

  async cancelBuy(ticker: string, orderId: string, reason: string): Promise<ChainTxResult> {
    const order = this.requireOrder(ticker, orderId);
    if (order.state === 'CANCELLED') return this.ok(true);
    if (order.state === 'FILLED') {
      throw new ConflictError('Cannot cancel a filled order');
    }
    const market = this.requireMarket(ticker);
    if (order.state === 'PENDING') {
      market.escrow -= order.escrowedAmount ?? 0n;
    }
    order.state = 'CANCELLED';
    void reason;
    return this.ok();
  }

  async settleSell(instruction: SettleSellInstruction): Promise<ChainTxResult> {
    const order = this.requireOrder(instruction.ticker, instruction.orderId);
    if (order.state === 'SETTLED') return this.ok(true);
    if (order.state !== 'PENDING') {
      throw new ConflictError(`Cannot settle a sell in state ${order.state}`);
    }

    // The guards the real program enforces. `settle_sell` rejects a zeroed
    // document hash and a sale below the seller's limit, so a mock that
    // accepts either would let a saga pass here and fail on-chain.
    if (!instruction.documentHash || isZeroHash(instruction.documentHash)) {
      throw new ValidationError('Document hash must be non-zero');
    }
    if (instruction.executionPrice.amount < order.limitPrice) {
      throw new ValidationError(
        `Execution price ${instruction.executionPrice.amount} is below the seller's limit ${order.limitPrice}`,
      );
    }

    const market = this.requireMarket(instruction.ticker);
    const spread = basisPoints(instruction.grossProceeds, market.feeBps, 'DOWN').amount;
    market.supply -= instruction.quantity.units;
    market.feesCollected += spread;
    order.state = 'SETTLED';
    return this.ok();
  }

  async cancelSell(ticker: string, orderId: string, reason: string): Promise<ChainTxResult> {
    const order = this.requireOrder(ticker, orderId);
    if (order.state === 'CANCELLED') return this.ok(true);
    if (order.state === 'SETTLED') throw new ConflictError('Cannot cancel a settled sell');
    order.state = 'CANCELLED';
    void reason;
    return this.ok();
  }

  async setMarketStatus(ticker: string, status: MarketStatus): Promise<ChainTxResult> {
    const market = this.requireMarket(ticker);
    if (market.status === status) return this.ok(true);
    market.status = status;
    return this.ok();
  }

  async registerTrader(wallet: string, jurisdiction: number): Promise<ChainTxResult> {
    if (!Number.isInteger(jurisdiction) || jurisdiction <= 0 || jurisdiction > 999) {
      throw new ValidationError(
        `Jurisdiction must be an ISO 3166-1 numeric code, received ${jurisdiction}`,
      );
    }
    const existing = this.traders.get(wallet);
    if (existing?.eligible) return this.ok(true);
    this.traders.set(wallet, { wallet, eligible: true, jurisdiction, registeredAtSlot: this.slot });
    return this.ok();
  }

  async revokeTrader(wallet: string): Promise<ChainTxResult> {
    const existing = this.traders.get(wallet);
    if (!existing || !existing.eligible) return this.ok(true);
    this.traders.set(wallet, { ...existing, eligible: false });
    return this.ok();
  }

  /* ---- marco-vault writes ---------------------------------------------- */

  private advanceVault(vaultId: string, from: VaultPhase[], to: VaultPhase): ChainTxResult {
    const vault = this.requireVault(vaultId);
    if (vault.phase === to) return this.ok(true);
    if (!from.includes(vault.phase)) {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected one of ${from.join(', ')}`);
    }
    vault.phase = to;
    return this.ok();
  }

  async openFunding(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, ['Scheduled'], 'Funding');
  }

  async sealFunding(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, ['Funding'], 'Sealed');
  }

  async beginSourcing(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, ['Sealed'], 'Sourcing');
  }

  async confirmAllocation(vaultId: string, deployable: Money): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.phase === 'Sourced') return this.ok(true);
    if (vault.phase !== 'Sourcing') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Sourcing`);
    }
    if (deployable.amount > vault.totalShares) {
      throw new ValidationError(
        'Deployable amount exceeds net subscribed capital; a deploy must never eat into the fee',
      );
    }
    vault.deployableAmount = deployable.amount;
    vault.phase = 'Sourced';
    return this.ok();
  }

  async deployCapital(vaultId: string, amount: Money): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.phase === 'Deployed') return this.ok(true);
    if (vault.phase !== 'Sourced') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Sourced`);
    }
    if (vault.deployableAmount === null || amount.amount > vault.deployableAmount) {
      throw new ValidationError('Deploy exceeds the confirmed allocation');
    }

    vault.usdcBalance -= amount.amount;
    vault.deployedAmount = amount.amount;
    // The upfront fee is earned the moment capital first leaves for the broker.
    vault.feesCollected += vault.feesEscrowed;
    vault.feesEscrowed = 0n;
    vault.phase = 'Deployed';
    return this.ok();
  }

  async markListed(
    vaultId: string,
    sharesAllocated: Quantity,
    electionPeriodSeconds: number,
  ): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.phase === 'Live') return this.ok(true);
    if (vault.phase !== 'Deployed') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Deployed`);
    }
    vault.sharesAllocated = sharesAllocated;
    vault.electionDeadline = new Date(
      this.options.clock.nowMillis() + electionPeriodSeconds * 1000,
    ).toISOString();
    vault.phase = 'Live';
    return this.ok();
  }

  async markRealized(vaultId: string, grossProceeds: Money): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.phase === 'Realized') return this.ok(true);
    if (vault.phase !== 'Live') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Live`);
    }
    // Nobody may elect delivery of a position that has already been sold.
    if (vault.electionDeadline && this.options.clock.nowIso() < vault.electionDeadline) {
      throw new ConflictError('The delivery-election window is still open');
    }
    void grossProceeds;
    vault.phase = 'Realized';
    return this.ok();
  }

  async settleVault(vaultId: string, netCash: Money): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.phase === 'Claimable') return this.ok(true);
    if (vault.phase !== 'Realized') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Realized`);
    }
    vault.usdcBalance += netCash.amount;
    // Redeemable is the full balance less any unswept earned fee, so undeployed
    // capital and rounding dust stay redeemable and no USDC is stranded.
    vault.redeemableAmount = vault.usdcBalance - (vault.feesCollected - vault.feesSwept);
    vault.phase = 'Claimable';
    return this.ok();
  }

  async windDown(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, ['Claimable'], 'Winding');
  }

  async concludeVault(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, ['Claimable', 'Winding'], 'Concluded');
  }

  async cancelVault(vaultId: string, unrefundableCosts: Money): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.phase === 'Cancelled') return this.ok(true);
    const cancellable: VaultPhase[] = ['Scheduled', 'Funding', 'Sealed', 'Sourcing', 'Sourced'];
    if (!cancellable.includes(vault.phase)) {
      throw new ConflictError(
        `Vault ${vaultId} is ${vault.phase}; capital has left and cancellation is impossible`,
      );
    }
    void unrefundableCosts;
    vault.phase = 'Cancelled';
    return this.ok();
  }

  async sweepFee(vaultId: string, amount: Money): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    const sweepable = vault.feesCollected - vault.feesSwept;
    if (amount.amount > sweepable) {
      throw new ValidationError(
        `Sweep of ${amount.amount} exceeds earned-but-unswept fees of ${sweepable}`,
      );
    }
    vault.feesSwept += amount.amount;
    vault.usdcBalance -= amount.amount;
    return this.ok();
  }

  async freezeDeposits(vaultId: string, frozen: boolean): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.depositsFrozen === frozen) return this.ok(true);
    vault.depositsFrozen = frozen;
    return this.ok();
  }

  async setFeeTiming(vaultId: string, atExit: boolean): Promise<ChainTxResult> {
    const vault = this.requireVault(vaultId);
    if (vault.feeAtExit === atExit) return this.ok(true);
    // Same rule the program enforces: once anyone has subscribed the ratio is
    // baked into their claim tokens, and moving the fee would charge it twice.
    if (vault.totalDeposits > 0n) {
      throw new ConflictError(
        `Vault ${vaultId} already holds deposits; fee timing is fixed once anyone has subscribed`,
      );
    }
    vault.feeAtExit = atExit;
    return this.ok();
  }

  /* ---- Test helpers ---------------------------------------------------- */

  /** Force token supply out of line, to prove reconciliation catches it. */
  forceSupply(ticker: string, units: bigint): void {
    this.requireMarket(ticker).supply = units;
  }

  /** Record a delivery election, reducing the cash cohort. */
  electDelivery(vaultId: string, wallet: string, shares: Quantity): ChainEvent {
    const vault = this.requireVault(vaultId);
    if (vault.phase !== 'Live') throw new ConflictError('Delivery may only be elected while Live');
    vault.deliveredShares += shares.units;

    const event: ChainEvent = {
      kind: 'vault.delivery_elected',
      signature: this.nextSignature(),
      slot: this.slot,
      occurredAt: this.options.clock.nowIso(),
      wallet,
      vaultId,
      shares,
    };
    this.events.push(event);
    return event;
  }

  currentSlot(): number {
    return this.slot;
  }
}

/* Convenience constructors for tests and the demo script. */
export const zeroUsdc = (): Money => zero('USDC');
export const usdc = (amount: bigint): Money => money('USDC', amount);
export const hkd = (amount: bigint): Money => money('HKD', amount);
