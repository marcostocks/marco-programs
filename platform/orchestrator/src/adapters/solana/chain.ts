/**
 * Real Solana gateway.
 *
 * Implements the same `ChainGateway` contract as `MockChain`, against the two
 * deployed Anchor programs. Three properties matter more than the mechanics:
 *
 * **Every write is idempotent by on-chain state.** Each method reads the
 * account first and returns `alreadyApplied: true` when the transition has
 * already landed. This is not an optimisation. A transaction that appears to
 * time out may still confirm, and blind resubmission of `deploy_capital` would
 * send the broker a second wire.
 *
 * **Failures are classified, never guessed.** A confirmed program error did
 * not happen and never will (terminal). A rejected blockhash did not happen
 * (retryable). A submitted transaction whose confirmation we lost is
 * *unknown* — it is resolved by reading state back, never by resubmitting.
 *
 * **Events, not account diffs, create intents.** `pollEvents` decodes the
 * `emit!` records added in `events.rs`, which is why those exist.
 */

import { AnchorProvider, BN, EventParser, Program, Wallet, type Idl } from '@coral-xyz/anchor';

import type { MarcoSpot } from './generated/marco_spot.js';
import type { MarcoVault } from './generated/marco_vault.js';
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  type ConfirmedSignatureInfo,
} from '@solana/web3.js';

import type { Clock } from '../../domain/clock.js';
import {
  ChainSubmissionIndeterminate,
  ConflictError,
  RetryableError,
  TerminalError,
  ValidationError,
} from '../../domain/errors.js';
import { money, quantity, type Money, type Quantity } from '../../domain/money.js';
import type {
  ChainCursor,
  ChainEvent,
  ChainEventKind,
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
import type { Logger } from '../../support/logger.js';
import { loadArtifacts, type MarcoArtifacts } from './artifacts.js';
import {
  buyerStatePda,
  holdingPda,
  marketPda,
  marketUsdcPda,
  orderPda,
  positionEscrowPda,
  positionMintPda,
  shareMintPda,
  traderAccountPda,
  vaultPda,
} from './pdas.js';

export interface SolanaChainOptions {
  readonly clock: Clock;
  readonly logger: Logger;
  readonly rpcUrl: string;
  /**
   * The operator keypair. Pays every fee, and is the sole signer for the four
   * instructions that accept `admin_or_operator`: `deploy_buy`, `confirm_buy`,
   * `settle_sell` and `deploy_capital`.
   */
  readonly operator: Keypair;
  /**
   * The admin keypair.
   *
   * Most phase transitions — `open_funding` through `settle`, plus every
   * market and vault creation — require the *admin* as signer, not the
   * operator. The driver cannot advance a deal without it.
   *
   * Holding both keys in one process is a development posture, not a
   * production one: it collapses the separation the programs deliberately
   * encode. Production splits them across custody (`SIGNER_KIND=kms|squads`),
   * which is why those are unimplemented rather than approximated.
   */
  readonly admin: Keypair;
  readonly artifacts?: MarcoArtifacts;
}

/* -------------------------------------------------------------------------- */
/* Decoded account shapes                                                      */
/* -------------------------------------------------------------------------- */

/** Anchor decodes enums as `{ variantName: {} }`. */
type AnchorEnum = Record<string, Record<string, never>>;

const enumVariant = (value: AnchorEnum): string => Object.keys(value)[0] ?? '';

const VAULT_PHASES: Record<string, VaultPhase> = {
  scheduled: 'Scheduled',
  funding: 'Funding',
  sealed: 'Sealed',
  sourcing: 'Sourcing',
  sourced: 'Sourced',
  deployed: 'Deployed',
  live: 'Live',
  realized: 'Realized',
  claimable: 'Claimable',
  winding: 'Winding',
  concluded: 'Concluded',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const ORDER_STATES: Record<string, SpotOrderState> = {
  pending: 'PENDING',
  deployed: 'DEPLOYED',
  filled: 'FILLED',
  settled: 'SETTLED',
  cancelled: 'CANCELLED',
};

const MARKET_STATUSES: Record<string, MarketStatus> = {
  active: 'ACTIVE',
  paused: 'PAUSED',
  closed: 'CLOSED',
};

/**
 * Anchor's TS `EventParser` lower-cases the leading character of the IDL name,
 * so `DepositMade` arrives as `depositMade`. Matching on the IDL spelling
 * silently finds nothing — a failure mode with no error to notice.
 */
const EVENT_KINDS: Record<string, ChainEventKind> = {
  buyPlaced: 'spot.buy_placed',
  buyCancelled: 'spot.buy_cancelled',
  sellPlaced: 'spot.sell_placed',
  sellCancelled: 'spot.sell_cancelled',
  depositMade: 'vault.deposit',
  claimMade: 'vault.claim',
  refundMade: 'vault.refund',
  deliveryElected: 'vault.delivery_elected',
};

const bnToBigInt = (value: BN): bigint => BigInt(value.toString());
const toBN = (value: bigint): BN => new BN(value.toString());

/** 32-byte on-chain arrays are carried as hex through the orchestrator. */
const bytesToHex = (bytes: number[] | Uint8Array): string =>
  Buffer.from(bytes).toString('hex');

const hexToBytes = (hex: string, what: string): number[] => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new ValidationError(`${what} must be a 32-byte hex digest, received "${hex}"`);
  }
  return Array.from(Buffer.from(clean, 'hex'));
};

const isZeroBytes = (bytes: number[] | Uint8Array): boolean =>
  Array.from(bytes).every((b) => b === 0);

/** Custody references are `[u8; 32]` on-chain, but human strings off it. */
const refToBytes = (ref: string): number[] => {
  const buf = Buffer.alloc(32);
  const written = Buffer.from(ref, 'utf8');
  if (written.length > 32) {
    throw new ValidationError(`Custody reference "${ref}" exceeds 32 bytes`);
  }
  written.copy(buf);
  return Array.from(buf);
};

const bytesToRef = (bytes: number[] | Uint8Array): string | null =>
  isZeroBytes(bytes) ? null : Buffer.from(bytes).toString('utf8').replace(/\0+$/, '');

const secondsToIso = (seconds: bigint): string | null =>
  seconds === 0n ? null : new Date(Number(seconds) * 1000).toISOString();

const isoToSeconds = (iso: string): BN => new BN(Math.floor(new Date(iso).getTime() / 1000));

/**
 * How long the set of watched accounts is reused before rediscovery.
 *
 * Short enough that a newly created vault starts being watched promptly, long
 * enough that a one-second poll loop does not call `getProgramAccounts` every
 * tick. A vault missed for this long is not missed — the cursor is by slot, so
 * the next poll picks up everything since.
 */
const WATCHLIST_TTL_MS = 30_000;

export class SolanaChain implements ChainGateway {
  readonly id = 'solana';

  private readonly connection: Connection;
  private readonly artifacts: MarcoArtifacts;
  private readonly spot: Program<MarcoSpot>;
  private readonly vault: Program<MarcoVault>;
  private readonly spotEvents: EventParser;
  private readonly vaultEvents: EventParser;
  private watchlist: PublicKey[] | null = null;
  private watchlistAt = 0;

  constructor(private readonly options: SolanaChainOptions) {
    this.artifacts = options.artifacts ?? loadArtifacts();
    this.connection = new Connection(options.rpcUrl, 'confirmed');

    const provider = new AnchorProvider(
      this.connection,
      new Wallet(options.operator),
      { commitment: 'confirmed', preflightCommitment: 'confirmed' },
    );

    this.spot = new Program(this.artifacts.spotIdl as MarcoSpot, provider);
    this.vault = new Program(this.artifacts.vaultIdl as MarcoVault, provider);
    this.spotEvents = new EventParser(this.artifacts.spotProgramId, this.spot.coder);
    this.vaultEvents = new EventParser(this.artifacts.vaultProgramId, this.vault.coder);
  }

  /* ---- Plumbing --------------------------------------------------------- */

  private get admin(): PublicKey {
    return this.options.admin.publicKey;
  }

  private vaultAddress(vaultId: string): PublicKey {
    return vaultPda(this.artifacts.vaultProgramId, this.admin, vaultId);
  }

  private marketAddress(ticker: string): PublicKey {
    return marketPda(this.artifacts.spotProgramId, this.admin, ticker);
  }

  private async ok(signature: string, alreadyApplied = false): Promise<ChainTxResult> {
    const status = await this.connection.getSignatureStatus(signature);
    return {
      signature,
      slot: status.value?.slot ?? 0,
      confirmedAt: this.options.clock.nowIso(),
      alreadyApplied,
    };
  }

  /** A no-op result for a transition on-chain state already satisfies. */
  private noop(): ChainTxResult {
    return {
      signature: '',
      slot: 0,
      confirmedAt: this.options.clock.nowIso(),
      alreadyApplied: true,
    };
  }

  /**
   * Submit one instruction, classifying failure by whether the effect happened.
   *
   * The distinction the runner acts on is *not* how bad the error is — it is
   * whether the money moved. An unrecognised throw is treated as ambiguous
   * rather than retryable, because the cost of being wrong in that direction
   * is a duplicate wire.
   */
  private async submit(instruction: string, send: () => Promise<string>): Promise<ChainTxResult> {
    try {
      return await this.ok(await send());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // A program error means the runtime rejected the instruction: it is
      // confirmed not to have taken effect.
      const logs = (error as { logs?: string[] }).logs;
      if (logs?.some((line) => line.includes('Program log: AnchorError')) === true) {
        throw new TerminalError({
          code: 'chain_program_error',
          message: `${instruction} was rejected by the program: ${message}`,
          context: { instruction, logs },
        });
      }

      // The transaction never entered the ledger, so it can be rebuilt and
      // resent with the same client reference.
      if (
        /Blockhash not found|blockhash.*expired|Node is behind|429|Too Many Requests|fetch failed|ECONNREFUSED/i.test(
          message,
        )
      ) {
        throw new RetryableError({
          code: 'chain_unavailable',
          message: `${instruction} could not be submitted: ${message}`,
          context: { instruction },
        });
      }

      // Submitted, outcome unobserved. Resolved by reading state, not retrying.
      throw new ChainSubmissionIndeterminate(instruction, message);
    }
  }

  /* ---- Reads ------------------------------------------------------------ */

  async getMarket(ticker: string): Promise<SpotMarket | null> {
    const address = this.marketAddress(ticker);
    const raw = await this.fetchOrNull(this.spot, 'market', address);
    if (!raw) return null;
    return this.hydrateMarket(address, raw);
  }

  /**
   * Finish a decoded market account into a `SpotMarket`.
   *
   * Split out so `listMarkets` maps every market exactly the way `getMarket`
   * maps one; two copies of this would drift.
   */
  private async hydrateMarket(
    address: PublicKey,
    raw: Record<string, unknown>,
  ): Promise<SpotMarket> {
    const ticker = raw.ticker as string;
    const positionMint = positionMintPda(this.artifacts.spotProgramId, address);
    const usdcAccount = marketUsdcPda(this.artifacts.spotProgramId, address);
    const [escrow, mint] = await Promise.all([
      getAccount(this.connection, usdcAccount).catch(() => null),
      getMint(this.connection, positionMint).catch(() => null),
    ]);

    return {
      ticker: raw.ticker as string,
      marketAddress: address.toBase58(),
      positionMint: positionMint.toBase58(),
      escrowBalance: money('USDC', escrow ? escrow.amount : 0n),
      positionSupply: quantity(ticker, mint ? mint.supply : 0n),
      status: MARKET_STATUSES[enumVariant(raw.status as AnchorEnum)] ?? 'CLOSED',
      feeBps: Number(raw.feeBps),
      settlementDestination: (raw.settlementDestination as PublicKey).toBase58(),
      feesCollected: money('USDC', bnToBigInt(raw.feesCollected as BN)),
      feesSwept: money('USDC', bnToBigInt(raw.feesSwept as BN)),
    };
  }

  async getSpotOrder(ticker: string, orderId: string): Promise<SpotOrder | null> {
    const market = this.marketAddress(ticker);
    const address = orderPda(this.artifacts.spotProgramId, market, BigInt(orderId));
    const raw = await this.fetchOrNull(this.spot, 'order', address);
    if (!raw) return null;

    const side = enumVariant(raw.side as AnchorEnum) === 'sell' ? 'SELL' : 'BUY';
    const usdc = bnToBigInt(raw.usdcAmount as BN);
    const shares = bnToBigInt(raw.sharesAmount as BN);

    return {
      orderId,
      orderAddress: address.toBase58(),
      ticker,
      side,
      trader: (raw.trader as PublicKey).toBase58(),
      state: ORDER_STATES[enumVariant(raw.status as AnchorEnum)] ?? 'PENDING',
      escrowedAmount: side === 'BUY' ? money('USDC', usdc) : null,
      escrowedShares: side === 'SELL' ? quantity(ticker, shares) : null,
      limitPrice: money('HKD', bnToBigInt(raw.limitPrice as BN)),
      requestedQuantity: quantity(ticker, side === 'SELL' ? shares : bnToBigInt(raw.minSharesOut as BN)),
      createdAtSlot: Number(bnToBigInt(raw.createdAt as BN)),
      custodyReference: bytesToRef(raw.custodyRef as number[]),
      documentHash: isZeroBytes(raw.docHash as number[])
        ? null
        : bytesToHex(raw.docHash as number[]),
    };
  }

  async getTraderAccount(wallet: string): Promise<TraderAccount | null> {
    const address = traderAccountPda(
      this.artifacts.spotProgramId,
      this.admin,
      new PublicKey(wallet),
    );
    const raw = await this.fetchOrNull(this.spot, 'traderAccount', address);
    if (!raw) return null;

    return {
      wallet,
      eligible: Boolean(raw.eligible),
      jurisdiction: Number(raw.jurisdiction ?? 0),
      registeredAtSlot: Number(bnToBigInt(raw.registeredAt as BN)),
    };
  }

  async getVault(vaultId: string): Promise<VaultState | null> {
    const address = this.vaultAddress(vaultId);
    const raw = await this.fetchOrNull(this.vault, 'vault', address);
    if (!raw) return null;
    return this.hydrateVault(address, raw);
  }

  /** As `hydrateMarket`, so `listVaults` and `getVault` cannot diverge. */
  private async hydrateVault(
    address: PublicKey,
    raw: Record<string, unknown>,
  ): Promise<VaultState> {
    const vaultId = raw.vaultId as string;
    const usdcAccount = raw.vaultUsdc as PublicKey;
    const balance = await getAccount(this.connection, usdcAccount).catch(() => null);
    const sharesAllocated = bnToBigInt(raw.sharesAllocated as BN);
    const redeemable = bnToBigInt(raw.redeemableAmount as BN);
    const deployable = bnToBigInt(raw.deployableAmount as BN);

    return {
      vaultId,
      vaultAddress: address.toBase58(),
      claimMint: shareMintPda(this.artifacts.vaultProgramId, address).toBase58(),
      phase: VAULT_PHASES[enumVariant(raw.phase as AnchorEnum)] ?? 'Scheduled',
      cap: money('USDC', bnToBigInt(raw.depositCap as BN)),
      totalDeposits: money('USDC', bnToBigInt(raw.totalDeposits as BN)),
      totalShares: bnToBigInt(raw.totalShares as BN),
      usdcBalance: money('USDC', balance ? balance.amount : 0n),
      feeBps: Number(raw.feeBps),
      feeAtExit: Boolean(raw.feeAtExit),
      feesEscrowed: money('USDC', bnToBigInt(raw.feesEscrowed as BN)),
      feesCollected: money('USDC', bnToBigInt(raw.feesCollected as BN)),
      feesSwept: money('USDC', bnToBigInt(raw.feesSwept as BN)),
      brokerDestination: (raw.depositDestination as PublicKey).toBase58(),
      // The program stores 0 for "not yet set"; the port distinguishes unset
      // from zero, and conflating them would let a deploy read as allowed.
      deployableAmount: deployable === 0n ? null : money('USDC', deployable),
      deployedAmount: money('USDC', bnToBigInt(raw.totalDeployed as BN)),
      sharesAllocated: sharesAllocated === 0n ? null : quantity(vaultId, sharesAllocated),
      deliveredShares: bnToBigInt(raw.deliveredShares as BN),
      redeemableAmount: redeemable === 0n ? null : money('USDC', redeemable),
      electionDeadline: secondsToIso(bnToBigInt(raw.electionDeadline as BN)),
    };
  }

  /**
   * Every market the program holds.
   *
   * `all()` is one `getProgramAccounts`, but each market still needs its escrow
   * balance and mint supply, so those are fetched in small batches rather than
   * all at once — a public RPC rate-limits a fan-out of that shape.
   */
  async listMarkets(): Promise<SpotMarket[]> {
    const accounts = await this.spot.account.market.all();
    return this.inBatches(accounts, (entry) =>
      this.hydrateMarket(entry.publicKey, entry.account as unknown as Record<string, unknown>),
    );
  }

  async listVaults(): Promise<VaultState[]> {
    const accounts = await this.vault.account.vault.all();
    return this.inBatches(accounts, (entry) =>
      this.hydrateVault(entry.publicKey, entry.account as unknown as Record<string, unknown>),
    );
  }

  /** Resolve `items` through `fn`, at most `size` in flight at a time. */
  private async inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>, size = 5): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    }
    return out;
  }

  async getHolding(ticker: string, wallet: string): Promise<SpotHolding | null> {
    const market = this.marketAddress(ticker);
    const address = holdingPda(this.artifacts.spotProgramId, market, new PublicKey(wallet));
    const raw = await this.fetchOrNull(this.spot, 'holding', address);
    if (!raw) return null;

    const bought = bnToBigInt(raw.sharesBought as BN);
    const sold = bnToBigInt(raw.sharesSold as BN);
    const spent = bnToBigInt(raw.usdcSpent as BN);
    const received = bnToBigInt(raw.usdcReceived as BN);

    return {
      ticker,
      wallet,
      sharesBought: quantity(ticker, bought),
      sharesSold: quantity(ticker, sold),
      openQuantity: quantity(ticker, bought - sold),
      usdcSpent: money('USDC', spent),
      usdcReceived: money('USDC', received),
      feesPaid: money('USDC', bnToBigInt(raw.feesPaid as BN)),
      // Both sides are 6dp fixed point, so the division has to be scaled back up
      // or every average cost would come back as zero.
      averageCost: bought === 0n ? null : money('USDC', (spent * 1_000_000n) / bought),
      // Proceeds less the cost of the shares actually sold — NOT `received -
      // spent`, which charges the whole position's cost against a partial exit
      // and reports a large loss on a position that is merely still open.
      realisedPnl: money(
        'USDC',
        bought === 0n ? 0n : received - (spent * sold) / bought,
      ),
    };
  }

  async getVaultPosition(vaultId: string, wallet: string): Promise<VaultPosition | null> {
    const vault = this.vaultAddress(vaultId);
    const address = buyerStatePda(this.artifacts.vaultProgramId, vault, new PublicKey(wallet));
    const raw = await this.fetchOrNull(this.vault, 'buyerState', address);
    if (!raw) return null;

    const minted = bnToBigInt(raw.sharesMinted as BN);
    const redeemed = bnToBigInt(raw.sharesRedeemed as BN);
    const delivered = bnToBigInt(raw.sharesDelivered as BN);

    return {
      vaultId,
      wallet,
      depositAmount: money('USDC', bnToBigInt(raw.depositAmount as BN)),
      sharesMinted: minted,
      sharesRedeemed: redeemed,
      sharesDelivered: delivered,
      openShares: minted - redeemed - delivered,
      usdcRedeemed: money('USDC', bnToBigInt(raw.usdcRedeemed as BN)),
      usdcRefunded: money('USDC', bnToBigInt(raw.usdcRefunded as BN)),
      entryFeePaid: money('USDC', bnToBigInt(raw.entryFeePaid as BN)),
    };
  }

  /** An account that does not exist is `null`, not an error. */
  private async fetchOrNull(
    program: Program<MarcoSpot> | Program<MarcoVault>,
    account: string,
    address: PublicKey,
  ): Promise<Record<string, unknown> | null> {
    try {
      const namespace = program.account as unknown as Record<
        string,
        { fetch: (address: PublicKey) => Promise<Record<string, unknown>> }
      >;
      const client = namespace[account];
      if (!client) throw new ValidationError(`No account "${account}" in the IDL`);
      return await client.fetch(address);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Account does not exist|could not find account/i.test(message)) return null;
      throw error;
    }
  }

  /* ---- Events ----------------------------------------------------------- */

  /**
   * Poll for holder-initiated events.
   *
   * **Polls the vault and market accounts, not the program ids.** Solana's
   * address-signature index covers the accounts a transaction *touches*; a
   * program id is not reliably among them, so `getSignaturesForAddress` on a
   * program returns nothing once a transaction leaves the recent-blocks cache.
   * That failure is silent — the watcher simply stops seeing deposits — which
   * is the worst shape a bug can take here, since a missed deposit is a holder
   * whose USDC is escrowed with nobody acting on it.
   *
   * Every vault and market PDA is writable in each of its holder instructions,
   * so polling those addresses is both reliable and complete.
   *
   * The cursor is a **slot**, not a signature, because many addresses cannot
   * share one signature cursor. Polling is inclusive of `lastSlot`, so an event
   * sharing a slot with the last processed one is re-delivered rather than
   * skipped. That is safe: the watcher dedupes on signature, so over-delivering
   * costs a lookup while under-delivering strands money.
   */
  async pollEvents(cursor: ChainCursor, limit: number): Promise<ChainEventPage> {
    const watched = await this.watchedAddresses();

    const pages = await Promise.all(
      watched.map((address) => this.signaturesSince(address, cursor.lastSlot, limit)),
    );

    // One transaction can touch several watched accounts, so dedupe before
    // decoding rather than parsing the same logs twice.
    const bySignature = new Map<string, ConfirmedSignatureInfo>();
    for (const info of pages.flat()) {
      if (info.err === null) bySignature.set(info.signature, info);
    }

    const ordered = [...bySignature.values()]
      .sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature))
      .slice(0, limit);

    const events: ChainEvent[] = [];
    for (const info of ordered) {
      events.push(...(await this.decodeTransaction(info)));
    }

    const last = ordered[ordered.length - 1];
    return {
      events,
      cursor: last
        ? { lastSignature: last.signature, lastSlot: last.slot }
        : cursor,
    };
  }

  /**
   * Every vault and market account, discovered from the programs themselves.
   *
   * Deriving the watchlist from chain rather than from configuration means a
   * vault created by another operator instance is still watched — nothing has
   * to remember to register it. Cached briefly because a poll runs on a timer
   * and `getProgramAccounts` is the expensive call here, not the signature
   * lookups.
   */
  private async watchedAddresses(): Promise<PublicKey[]> {
    const now = this.options.clock.nowMillis();
    if (this.watchlist && now - this.watchlistAt < WATCHLIST_TTL_MS) return this.watchlist;

    const [vaults, markets] = await Promise.all([
      this.vault.account.vault.all(),
      this.spot.account.market.all(),
    ]);

    this.watchlist = [...vaults, ...markets].map((entry) => entry.publicKey);
    this.watchlistAt = now;
    return this.watchlist;
  }

  private async signaturesSince(
    address: PublicKey,
    sinceSlot: number,
    limit: number,
  ): Promise<ConfirmedSignatureInfo[]> {
    // Returned newest-first; we want the window at or after `sinceSlot`.
    const page = await this.connection.getSignaturesForAddress(address, {
      limit: Math.max(limit, 50),
    });
    return page.filter((info) => info.slot >= sinceSlot);
  }

  private async decodeTransaction(info: ConfirmedSignatureInfo): Promise<ChainEvent[]> {
    const tx = await this.connection.getTransaction(info.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages;
    if (!logs) return [];

    const occurredAt = new Date((info.blockTime ?? 0) * 1000).toISOString();
    const decoded: ChainEvent[] = [];

    for (const parser of [this.spotEvents, this.vaultEvents]) {
      let parsed;
      try {
        parsed = parser.parseLogs(logs);
      } catch {
        // Logs from the other program are not an error, just not ours.
        continue;
      }
      for (const event of parsed) {
        const mapped = this.mapEvent(event.name, event.data as Record<string, unknown>, {
          signature: info.signature,
          slot: info.slot,
          occurredAt,
        });
        if (mapped) decoded.push(mapped);
      }
    }
    return decoded;
  }

  private mapEvent(
    name: string,
    data: Record<string, unknown>,
    tx: { signature: string; slot: number; occurredAt: string },
  ): ChainEvent | null {
    const kind = EVENT_KINDS[name];
    if (!kind) return null;

    const base = { kind, ...tx } as const;

    switch (kind) {
      case 'spot.buy_placed':
        return {
          ...base,
          wallet: (data.trader as PublicKey).toBase58(),
          ticker: data.ticker as string,
          orderId: (data.orderId as BN).toString(),
          amount: money('USDC', bnToBigInt(data.usdcAmount as BN)),
          shares: quantity(data.ticker as string, bnToBigInt(data.minSharesOut as BN)),
          limitPrice: money('HKD', bnToBigInt(data.limitPrice as BN)),
        };

      case 'spot.sell_placed':
        return {
          ...base,
          wallet: (data.trader as PublicKey).toBase58(),
          ticker: data.ticker as string,
          orderId: (data.orderId as BN).toString(),
          shares: quantity(data.ticker as string, bnToBigInt(data.shares as BN)),
          limitPrice: money('HKD', bnToBigInt(data.limitPrice as BN)),
        };

      case 'spot.buy_cancelled':
        return {
          ...base,
          wallet: (data.trader as PublicKey).toBase58(),
          ticker: data.ticker as string,
          orderId: (data.orderId as BN).toString(),
          amount: money('USDC', bnToBigInt(data.usdcRefunded as BN)),
        };

      case 'spot.sell_cancelled':
        return {
          ...base,
          wallet: (data.trader as PublicKey).toBase58(),
          ticker: data.ticker as string,
          orderId: (data.orderId as BN).toString(),
          shares: quantity(data.ticker as string, bnToBigInt(data.sharesReturned as BN)),
        };

      case 'vault.deposit':
        return {
          ...base,
          wallet: (data.depositor as PublicKey).toBase58(),
          vaultId: data.vaultId as string,
          // Gross, so the cap and the ledger agree with what left the wallet.
          amount: money('USDC', bnToBigInt(data.accepted as BN)),
          shares: quantity(data.vaultId as string, bnToBigInt(data.subscribed as BN)),
        };

      case 'vault.claim':
        return {
          ...base,
          wallet: (data.claimant as PublicKey).toBase58(),
          vaultId: data.vaultId as string,
          amount: money('USDC', bnToBigInt(data.usdcPaid as BN)),
          shares: quantity(data.vaultId as string, bnToBigInt(data.sharesBurned as BN)),
        };

      case 'vault.refund':
        return {
          ...base,
          wallet: (data.holder as PublicKey).toBase58(),
          vaultId: data.vaultId as string,
          amount: money('USDC', bnToBigInt(data.usdcPaid as BN)),
          shares: quantity(data.vaultId as string, bnToBigInt(data.sharesBurned as BN)),
        };

      case 'vault.delivery_elected':
        return {
          ...base,
          wallet: (data.holder as PublicKey).toBase58(),
          vaultId: data.vaultId as string,
          shares: quantity(data.vaultId as string, bnToBigInt(data.sharesBurned as BN)),
        };
    }
  }

  /* ---- Creation ---------------------------------------------------------- */

  async initializeMarket(params: InitializeMarketParams): Promise<ChainTxResult> {
    const existing = await this.getMarket(params.ticker);
    if (existing) return this.noop();

    const market = this.marketAddress(params.ticker);
    return this.submit('initialize_market', () =>
      this.spot.methods
        .initializeMarket({
          ticker: params.ticker,
          shareDecimals: params.shareDecimals,
          feeBps: params.feeBps,
          minOrderUsdc: toBN(params.minOrderUsdc.amount),
          maxOrderUsdc: toBN(params.maxOrderUsdc.amount),
        })
        .accountsPartial({
          market,
          positionMint: positionMintPda(this.artifacts.spotProgramId, market),
          marketUsdc: marketUsdcPda(this.artifacts.spotProgramId, market),
          positionEscrow: positionEscrowPda(this.artifacts.spotProgramId, market),
          usdcMint: this.artifacts.usdcMint,
          settlementDestination: new PublicKey(params.settlementDestination),
          admin: this.admin,
          operator: this.options.operator.publicKey,
          treasury: new PublicKey(params.treasury),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );
  }

  async initializeVault(params: InitializeVaultParams): Promise<ChainTxResult> {
    const existing = await this.getVault(params.vaultId);
    if (existing) return this.noop();

    const vault = this.vaultAddress(params.vaultId);

    // The program takes the vault's USDC account rather than creating it, so
    // it has to exist first. An ATA of the vault PDA is used because it is
    // derivable — a plain token account would mean persisting a keypair whose
    // loss would strand the vault's cash.
    const vaultUsdc = await this.ensureVaultUsdc(vault);

    return this.submit('initialize_vault', () =>
      this.vault.methods
        .initializeVault({
          vaultId: params.vaultId,
          depositCap: toBN(params.depositCap.amount),
          minDeposit: toBN(params.minDeposit.amount),
          maxDeposit: toBN(params.maxDeposit.amount),
          fundingStart: isoToSeconds(params.fundingStart),
          fundingDeadline: isoToSeconds(params.fundingDeadline),
          closeOutAt: isoToSeconds(params.closeOutAt),
          feeBps: params.feeBps,
        })
        .accountsPartial({
          vault,
          shareMint: shareMintPda(this.artifacts.vaultProgramId, vault),
          vaultUsdc,
          depositDestination: new PublicKey(params.depositDestination),
          admin: this.options.admin.publicKey,
          operator: this.options.operator.publicKey,
          treasury: new PublicKey(params.treasury),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  /** The vault PDA's USDC ATA, created on first use. Off-curve owner. */
  private async ensureVaultUsdc(vault: PublicKey): Promise<PublicKey> {
    const account = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.options.admin,
      this.artifacts.usdcMint,
      vault,
      true,
    );
    return account.address;
  }

  /* ---- marco-spot writes -------------------------------------------------- */

  async deployBuy(ticker: string, orderId: string): Promise<ChainTxResult> {
    const order = await this.requireOrder(ticker, orderId);
    if (order.state === 'DEPLOYED' || order.state === 'FILLED') return this.noop();
    if (order.state !== 'PENDING') {
      throw new ConflictError(`Cannot deploy an order in state ${order.state}`);
    }

    const market = this.marketAddress(ticker);
    const marketState = await this.requireMarket(ticker);
    return this.submit('deploy_buy', () =>
      this.spot.methods
        .deployBuy()
        .accountsPartial({
          market,
          order: orderPda(this.artifacts.spotProgramId, market, BigInt(orderId)),
          marketUsdc: marketUsdcPda(this.artifacts.spotProgramId, market),
          destination: new PublicKey(marketState.settlementDestination),
          adminOrOperator: this.options.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  }

  async confirmBuy(attestation: ConfirmBuyAttestation): Promise<ChainTxResult> {
    const order = await this.requireOrder(attestation.ticker, attestation.orderId);
    if (order.state === 'FILLED') return this.noop();
    if (order.state !== 'DEPLOYED') {
      throw new ConflictError(`Cannot confirm an order in state ${order.state}`);
    }

    // Checked here as well as on-chain so a bad attestation fails before it
    // costs a transaction, and with a message that names the field.
    if (!attestation.custodyReference.trim()) {
      throw new ValidationError('Custody reference must be non-zero');
    }
    const docHash = hexToBytes(attestation.documentHash, 'documentHash');
    if (isZeroBytes(docHash)) throw new ValidationError('Document hash must be non-zero');

    const market = this.marketAddress(attestation.ticker);
    const trader = new PublicKey(order.trader);
    const positionMint = positionMintPda(this.artifacts.spotProgramId, market);
    const traderPosition = await this.tokenAccountFor(positionMint, trader);

    return this.submit('confirm_buy', () =>
      this.spot.methods
        .confirmBuy(
          toBN(attestation.quantity.units),
          toBN(attestation.averagePrice.amount),
          refToBytes(attestation.custodyReference),
          docHash,
        )
        .accountsPartial({
          market,
          order: orderPda(this.artifacts.spotProgramId, market, BigInt(attestation.orderId)),
          holding: holdingPda(this.artifacts.spotProgramId, market, trader),
          positionMint,
          traderPosition,
          adminOrOperator: this.options.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  }

  async cancelBuy(ticker: string, orderId: string, reason: string): Promise<ChainTxResult> {
    const order = await this.requireOrder(ticker, orderId);
    if (order.state === 'CANCELLED') return this.noop();
    if (order.state === 'FILLED' || order.state === 'SETTLED') {
      throw new ConflictError(`Cannot cancel an order in state ${order.state}`);
    }
    this.options.logger.info({ ticker, orderId, reason }, 'Cancelling buy on-chain');

    const market = this.marketAddress(ticker);
    const trader = new PublicKey(order.trader);
    const traderUsdc = await this.tokenAccountFor(this.artifacts.usdcMint, trader);
    return this.submit('cancel_buy', () =>
      this.spot.methods
        .cancelBuy()
        .accountsPartial({
          market,
          order: orderPda(this.artifacts.spotProgramId, market, BigInt(orderId)),
          marketUsdc: marketUsdcPda(this.artifacts.spotProgramId, market),
          traderUsdc,
          signer: this.options.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  }

  async settleSell(instruction: SettleSellInstruction): Promise<ChainTxResult> {
    const order = await this.requireOrder(instruction.ticker, instruction.orderId);
    if (order.state === 'SETTLED') return this.noop();
    if (order.state !== 'PENDING') {
      throw new ConflictError(`Cannot settle a sell in state ${order.state}`);
    }

    const docHash = hexToBytes(instruction.documentHash, 'documentHash');
    if (isZeroBytes(docHash)) throw new ValidationError('Document hash must be non-zero');

    const market = this.marketAddress(instruction.ticker);
    const trader = new PublicKey(order.trader);
    const traderUsdc = await this.tokenAccountFor(this.artifacts.usdcMint, trader);
    return this.submit('settle_sell', () =>
      this.spot.methods
        .settleSell(
          toBN(instruction.grossProceeds.amount),
          toBN(instruction.executionPrice.amount),
          docHash,
        )
        .accountsPartial({
          market,
          order: orderPda(this.artifacts.spotProgramId, market, BigInt(instruction.orderId)),
          holding: holdingPda(this.artifacts.spotProgramId, market, trader),
          positionMint: positionMintPda(this.artifacts.spotProgramId, market),
          positionEscrow: positionEscrowPda(this.artifacts.spotProgramId, market),
          marketUsdc: marketUsdcPda(this.artifacts.spotProgramId, market),
          traderUsdc,
          adminOrOperator: this.options.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  }

  async cancelSell(ticker: string, orderId: string, reason: string): Promise<ChainTxResult> {
    const order = await this.requireOrder(ticker, orderId);
    if (order.state === 'CANCELLED') return this.noop();
    if (order.state === 'SETTLED') throw new ConflictError('Cannot cancel a settled sell');
    this.options.logger.info({ ticker, orderId, reason }, 'Cancelling sell on-chain');

    const market = this.marketAddress(ticker);
    const trader = new PublicKey(order.trader);
    const positionMint = positionMintPda(this.artifacts.spotProgramId, market);
    const traderPosition = await this.tokenAccountFor(positionMint, trader);
    return this.submit('cancel_sell', () =>
      this.spot.methods
        .cancelSell()
        .accountsPartial({
          market,
          order: orderPda(this.artifacts.spotProgramId, market, BigInt(orderId)),
          positionMint,
          positionEscrow: positionEscrowPda(this.artifacts.spotProgramId, market),
          traderPosition,
          signer: this.options.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  }

  async setMarketStatus(ticker: string, status: MarketStatus): Promise<ChainTxResult> {
    const market = await this.requireMarket(ticker);
    if (market.status === status) return this.noop();

    const variant = { ACTIVE: { active: {} }, PAUSED: { paused: {} }, CLOSED: { closed: {} } }[
      status
    ];
    return this.submit('set_market_status', () =>
      this.spot.methods
        .setMarketStatus(variant)
        .accountsPartial({ market: this.marketAddress(ticker), admin: this.admin })
        .rpc(),
    );
  }

  async registerTrader(wallet: string, jurisdiction: number): Promise<ChainTxResult> {
    const existing = await this.getTraderAccount(wallet);
    if (existing?.eligible) return this.noop();
    return this.setTraderEligibility(wallet, true, jurisdiction);
  }

  async revokeTrader(wallet: string): Promise<ChainTxResult> {
    const existing = await this.getTraderAccount(wallet);
    if (!existing || !existing.eligible) return this.noop();
    // Revocation is registration with eligibility cleared — the program has no
    // separate instruction, and the record is kept for audit rather than
    // closed. Jurisdiction is preserved: it records where the verification was
    // performed, which stays true after eligibility is withdrawn.
    return this.setTraderEligibility(wallet, false, existing.jurisdiction);
  }

  private setTraderEligibility(
    wallet: string,
    eligible: boolean,
    jurisdiction: number,
  ): Promise<ChainTxResult> {
    const trader = new PublicKey(wallet);
    return this.submit('register_trader', () =>
      this.spot.methods
        .registerTrader(eligible, jurisdiction)
        .accountsPartial({
          traderAccount: traderAccountPda(this.artifacts.spotProgramId, this.admin, trader),
          trader,
          admin: this.admin,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  /* ---- marco-vault writes -------------------------------------------------- */

  async openFunding(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, 'openFunding', ['Scheduled'], 'Funding');
  }

  async sealFunding(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, 'sealFunding', ['Funding'], 'Sealed');
  }

  async beginSourcing(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, 'beginSourcing', ['Sealed'], 'Sourcing');
  }

  async confirmAllocation(vaultId: string, deployable: Money): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.phase === 'Sourced') return this.noop();
    if (vault.phase !== 'Sourcing') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Sourcing`);
    }
    return this.submit('confirm_allocation', () =>
      this.vault.methods
        .confirmAllocation(toBN(deployable.amount))
        .accountsPartial({ vault: this.vaultAddress(vaultId), admin: this.admin })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  async deployCapital(vaultId: string, amount: Money): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.phase === 'Deployed') return this.noop();
    if (vault.phase !== 'Sourced') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Sourced`);
    }
    if (vault.deployableAmount === null || amount.amount > vault.deployableAmount.amount) {
      throw new ValidationError('Deploy exceeds the confirmed allocation');
    }

    const address = this.vaultAddress(vaultId);
    return this.submit('deploy_capital', async () =>
      this.vault.methods
        .deployCapital(toBN(amount.amount))
        .accountsPartial({
          vault: address,
          vaultUsdc: await this.vaultUsdcOf(vaultId),
          // Immutable, read from the vault rather than supplied — the program
          // enforces this too, but a mismatch should fail before submission.
          destination: new PublicKey(vault.brokerDestination),
          adminOrOperator: this.options.operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
  }

  /** The USDC account recorded on the vault at creation. */
  private async vaultUsdcOf(vaultId: string): Promise<PublicKey> {
    const raw = await this.fetchOrNull(this.vault, 'vault', this.vaultAddress(vaultId));
    if (!raw) throw new ValidationError(`No vault ${vaultId}`);
    return raw.vaultUsdc as PublicKey;
  }

  async markListed(
    vaultId: string,
    sharesAllocated: Quantity,
    electionPeriodSeconds: number,
  ): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.phase === 'Live') return this.noop();
    if (vault.phase !== 'Deployed') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Deployed`);
    }
    return this.submit('mark_listed', () =>
      this.vault.methods
        .markListed(toBN(sharesAllocated.units), new BN(electionPeriodSeconds))
        .accountsPartial({ vault: this.vaultAddress(vaultId), admin: this.admin })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  async markRealized(vaultId: string, grossProceeds: Money): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.phase === 'Realized') return this.noop();
    if (vault.phase !== 'Live') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Live`);
    }
    return this.submit('mark_realized', () =>
      this.vault.methods
        .markRealized(toBN(grossProceeds.amount))
        .accountsPartial({ vault: this.vaultAddress(vaultId), admin: this.admin })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  async settleVault(vaultId: string, netCash: Money): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.phase === 'Claimable') return this.noop();
    if (vault.phase !== 'Realized') {
      throw new ConflictError(`Vault ${vaultId} is ${vault.phase}; expected Realized`);
    }
    return this.submit('settle', async () =>
      this.vault.methods
        .settle(toBN(netCash.amount))
        .accountsPartial({
          vault: this.vaultAddress(vaultId),
          vaultUsdc: await this.vaultUsdcOf(vaultId),
          admin: this.admin,
        })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  async windDown(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, 'windDown', ['Claimable'], 'Winding');
  }

  async concludeVault(vaultId: string): Promise<ChainTxResult> {
    return this.advanceVault(vaultId, 'conclude', ['Winding', 'Claimable'], 'Concluded');
  }

  async cancelVault(vaultId: string, unrefundableCosts: Money): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.phase === 'Cancelled') return this.noop();
    return this.submit('cancel_vault', () =>
      this.vault.methods
        .cancelVault(toBN(unrefundableCosts.amount))
        .accountsPartial({ vault: this.vaultAddress(vaultId), admin: this.admin })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  async sweepFee(vaultId: string, amount: Money): Promise<ChainTxResult> {
    return this.submit('sweep_fee', async () =>
      this.vault.methods
        .sweepFee(toBN(amount.amount))
        .accountsPartial({
          vault: this.vaultAddress(vaultId),
          vaultUsdc: await this.vaultUsdcOf(vaultId),
          treasuryUsdc: new PublicKey(this.artifacts.addresses.tokenAccounts.treasuryUsdc),
          treasury: this.artifacts.treasury,
          admin: this.admin,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  async freezeDeposits(vaultId: string, frozen: boolean): Promise<ChainTxResult> {
    return this.submit('freeze_deposits', () =>
      this.vault.methods
        .freezeDeposits(frozen)
        .accountsPartial({ vault: this.vaultAddress(vaultId), admin: this.admin })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  async setFeeTiming(vaultId: string, atExit: boolean): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.feeAtExit === atExit) return this.noop();
    // The program enforces this too, but failing here names the reason rather
    // than surfacing a raw constraint violation from the instruction.
    if (vault.totalDeposits.amount > 0n) {
      throw new ConflictError(
        `Vault ${vaultId} already holds deposits; fee timing is fixed once anyone has subscribed`,
      );
    }
    return this.submit('set_fee_timing', () =>
      this.vault.methods
        .setFeeTiming(atExit)
        .accountsPartial({ vault: this.vaultAddress(vaultId), admin: this.admin })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  /* ---- Shared helpers ----------------------------------------------------- */

  /** Phase transitions that take no arguments and only need the admin. */
  private async advanceVault(
    vaultId: string,
    method: string,
    from: readonly VaultPhase[],
    to: VaultPhase,
  ): Promise<ChainTxResult> {
    const vault = await this.requireVault(vaultId);
    if (vault.phase === to) return this.noop();
    if (!from.includes(vault.phase)) {
      throw new ConflictError(
        `Vault ${vaultId} is ${vault.phase}; expected one of ${from.join(', ')}`,
      );
    }
    const builder = (this.vault.methods as Record<string, () => {
      accountsPartial: (a: Record<string, PublicKey>) => {
        signers: (s: Keypair[]) => { rpc: () => Promise<string> };
      };
    }>)[method];
    if (!builder) throw new ValidationError(`No instruction "${method}" in the vault IDL`);

    return this.submit(method, () =>
      builder()
        .accountsPartial({ vault: this.vaultAddress(vaultId), admin: this.admin })
        .signers([this.options.admin])
        .rpc(),
    );
  }

  private async requireVault(vaultId: string): Promise<VaultState> {
    const vault = await this.getVault(vaultId);
    if (!vault) throw new ValidationError(`No vault ${vaultId}`);
    return vault;
  }

  private async requireMarket(ticker: string): Promise<SpotMarket> {
    const market = await this.getMarket(ticker);
    if (!market) throw new ValidationError(`No market for ${ticker}`);
    return market;
  }

  private async requireOrder(ticker: string, orderId: string): Promise<SpotOrder> {
    const order = await this.getSpotOrder(ticker, orderId);
    if (!order) throw new ValidationError(`No order ${orderId} on ${ticker}`);
    return order;
  }

  /**
   * The holder's token account for a mint.
   *
   * Both programs constrain these by owner and mint rather than requiring an
   * associated token account, so the account is looked up rather than derived —
   * a holder who funded through a non-ATA would otherwise be unreachable.
   */
  private async tokenAccountFor(mint: PublicKey, owner: PublicKey): Promise<PublicKey> {
    const found = await this.connection.getTokenAccountsByOwner(owner, { mint });
    const account = found.value[0];
    if (!account) {
      throw new ValidationError(
        `${owner.toBase58()} holds no token account for mint ${mint.toBase58()}`,
      );
    }
    return account.pubkey;
  }
}
