/**
 * The browser's connection to marco-vault.
 *
 * Bundled by `src/build-chain.js` into `marco-chain.js`, loaded lazily beside
 * `index.html` on the first wallet connect. It is deliberately NOT inlined into
 * the page: the site is a single self-contained file for everyone who only
 * reads it, and nobody should pay a megabyte of Solana libraries to look at a
 * vault card.
 *
 * The one rule this file exists to honour: **deposits and claims are signed by
 * the holder's wallet, never by the operator.** The orchestrator can advance a
 * deal, but it can never move a holder's money. If a code path here ever signs
 * on a user's behalf without their wallet, the whole trust model is gone.
 */

import { AnchorProvider, BN, EventParser, Program } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

import addresses from '../../shared/marco-artifacts/addresses.json';
import vaultIdl from '../../shared/marco-artifacts/idl/marco_vault.json';
import spotIdl from '../../shared/marco-artifacts/idl/marco_spot.json';
import futuresIdl from '../../shared/marco-artifacts/idl/marco_futures.json';

const VAULT_PROGRAM_ID = new PublicKey(addresses.programs.marcoVault);
const SPOT_PROGRAM_ID = new PublicKey(addresses.programs.marcoSpot);
const FUTURES_PROGRAM_ID = new PublicKey(addresses.programs.marcoFutures);
const USDC_MINT = new PublicKey(addresses.usdc.mint);
const ADMIN = new PublicKey(addresses.wallets.admin);
const DECIMALS = addresses.usdc.decimals;

const enc = (s) => new TextEncoder().encode(s);

/** Mirrors `orchestrator/src/adapters/solana/pdas.ts`. Same seeds, same order. */
const vaultPda = (vaultId) =>
  PublicKey.findProgramAddressSync(
    [enc('vault'), ADMIN.toBuffer(), enc(vaultId)],
    VAULT_PROGRAM_ID,
  )[0];

const shareMintPda = (vault) =>
  PublicKey.findProgramAddressSync([enc('share_mint'), vault.toBuffer()], VAULT_PROGRAM_ID)[0];

const buyerStatePda = (vault, depositor) =>
  PublicKey.findProgramAddressSync(
    [enc('buyer'), vault.toBuffer(), depositor.toBuffer()],
    VAULT_PROGRAM_ID,
  )[0];

/* ---- marco-spot PDAs. Mirrors orchestrator/src/adapters/solana/pdas.ts. ---- */

const marketPda = (ticker) =>
  PublicKey.findProgramAddressSync(
    [enc('market'), ADMIN.toBuffer(), enc(ticker)],
    SPOT_PROGRAM_ID,
  )[0];

const positionMintPda = (market) =>
  PublicKey.findProgramAddressSync([enc('position_mint'), market.toBuffer()], SPOT_PROGRAM_ID)[0];

const marketUsdcPda = (market) =>
  PublicKey.findProgramAddressSync([enc('market_usdc'), market.toBuffer()], SPOT_PROGRAM_ID)[0];

const positionEscrowPda = (market) =>
  PublicKey.findProgramAddressSync([enc('position_escrow'), market.toBuffer()], SPOT_PROGRAM_ID)[0];

const orderPda = (market, orderId) => {
  // u64 little-endian, without reaching for Buffer in browser code.
  const le = new Uint8Array(8);
  new DataView(le.buffer).setBigUint64(0, BigInt(orderId.toString()), true);
  return PublicKey.findProgramAddressSync(
    [enc('order'), market.toBuffer(), le],
    SPOT_PROGRAM_ID,
  )[0];
};

const holdingPda = (market, trader) =>
  PublicKey.findProgramAddressSync(
    [enc('holding'), market.toBuffer(), trader.toBuffer()],
    SPOT_PROGRAM_ID,
  )[0];

/* marco-futures: [config] → [market, config, id] → per-market vaults and positions */
const futPda = (...seeds) => PublicKey.findProgramAddressSync(seeds, FUTURES_PROGRAM_ID)[0];
const futConfigPda = () => futPda(enc('config'));
const futMarketPda = (id) => futPda(enc('market'), futConfigPda().toBuffer(), enc(id));
const futCollateralPda = (market) => futPda(enc('collateral'), market.toBuffer());
const futInsurancePda = (market) => futPda(enc('insurance'), market.toBuffer());
const futPositionPda = (market, owner) => futPda(enc('position'), market.toBuffer(), owner.toBuffer());
/* Prices are a 1e6 index where 1.0 == $1B of valuation. */
const fromIndex = (bn) => Number(bn?.toString() ?? 0) / 1e6;

const traderAccountPda = (trader) =>
  PublicKey.findProgramAddressSync(
    [enc('trader'), ADMIN.toBuffer(), trader.toBuffer()],
    SPOT_PROGRAM_ID,
  )[0];

/** Base units ⇄ display units. USDC and the claim token are both 6-decimal. */
const toBase = (n) => new BN(Math.round(Number(n) * 10 ** DECIMALS).toString());
const fromBase = (bn) => Number(bn?.toString() ?? 0) / 10 ** DECIMALS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The public devnet RPC throttles hard, and getSignaturesForAddress /
// getTransaction are the heaviest reads on the page. web3.js retries a 429 a few
// times and then throws; this adds a patient outer layer so a transient throttle
// does not lose the call. Patient enough to actually succeed against a throttled
// RPC — too few tries and a row gets dropped and never shown.
const retryRpc = async (fn, tries = 6, base = 300) => {
  let err;
  for (let i = 0; i < tries; i += 1) {
    try { return await fn(); } catch (e) { err = e; await sleep(base * (i + 1)); }
  }
  throw err;
};

// One shared pace for every getTransaction across the whole client — personal
// history, the activity feed, several vaults at once. Shared-tier RPCs cap
// requests per second (Helius' free tier at 10/s) and answer a burst with a wall
// of 429s and their backoff; holding starts to ≈8.7/s turns that burst into an
// orderly queue instead. A single module-level cursor means concurrent callers
// interleave rather than each pacing itself and together overshooting.
let _rpcSlot = 0;
const paceRpc = () => {
  const now = Date.now();
  const wait = Math.max(0, _rpcSlot - now);
  _rpcSlot = Math.max(now, _rpcSlot) + 115;
  return wait ? sleep(wait) : Promise.resolve();
};

// Applying that pace at the transport layer covers every RPC method at once —
// getAccountInfo, getSignaturesForAddress, getTransaction — so a page load that
// fires many reads together drains as one orderly ≈8.7/s queue instead of a
// burst the shared tier answers with 429s and multi-second backoffs. web3.js
// calls this for every HTTP RPC request; subscriptions use a socket and are
// unaffected. Falls back to the default fetch where none is on the global.
const _rawFetch = (typeof globalThis !== 'undefined' && globalThis.fetch)
  ? globalThis.fetch.bind(globalThis) : null;
const pacedFetch = _rawFetch
  ? (...args) => paceRpc().then(() => _rawFetch(...args)) : null;

// Decoded deposit records cached per (vault, signature). A transaction is
// immutable, so the activity feed only fetches a signature it has never seen —
// repeat landings read the feed from localStorage. The stored value is the
// decoded record, or null for a signature that carried no deposit for this
// vault, so a "nothing here" answer is remembered too and never re-fetched.
// getItem returns null for a MISS, so a cached null is told apart from a miss.
const _RDV = 'rd1';
const rdGet = (vaultId, sig) => {
  try {
    const s = localStorage.getItem(`${_RDV}:${vaultId}:${sig}`);
    return s === null ? undefined : JSON.parse(s);
  } catch { return undefined; }
};
const rdSet = (vaultId, sig, rec) => {
  try { localStorage.setItem(`${_RDV}:${vaultId}:${sig}`, JSON.stringify(rec)); }
  catch { /* private mode / quota — the feed still works, just uncached */ }
};

const PHASES = {
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

const shorten = (address) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/* -------------------------------------------------------------------------- */
/* Wallets                                                                     */
/* -------------------------------------------------------------------------- */

/** An injected browser wallet (Phantom, Solflare, Backpack). */
function injectedWallet() {
  const provider = globalThis.solana ?? globalThis.phantom?.solana;
  if (!provider?.isPhantom && !provider?.signTransaction) return null;
  return {
    kind: 'injected',
    provider,
    async connect() {
      const { publicKey } = await provider.connect();
      return new PublicKey(publicKey.toString());
    },
    disconnect: () => provider.disconnect?.(),
    signTransaction: (tx) => provider.signTransaction(tx),
    signAllTransactions: (txs) => provider.signAllTransactions(txs),
  };
}

const DEV_KEY = 'marco.devWallet';

/**
 * A burner keypair held in localStorage.
 *
 * Only offered against a local validator. Browser wallets cannot reach
 * `127.0.0.1`, so without this the deposit path could not be exercised in a
 * browser at all — and an integration that has never run in a browser is not
 * an integration. It is never offered against a public cluster: a key in
 * localStorage is a key on someone's disk.
 */
function devWallet() {
  if (!isLocalCluster()) return null;

  let keypair;
  const saved = globalThis.localStorage?.getItem(DEV_KEY);
  if (saved) {
    keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
  } else {
    keypair = Keypair.generate();
    globalThis.localStorage?.setItem(DEV_KEY, JSON.stringify(Array.from(keypair.secretKey)));
  }

  return {
    kind: 'dev',
    keypair,
    connect: async () => keypair.publicKey,
    disconnect: () => {},
    signTransaction: async (tx) => {
      tx.partialSign(keypair);
      return tx;
    },
    signAllTransactions: async (txs) => txs.map((tx) => (tx.partialSign(keypair), tx)),
  };
}

const isLocalCluster = () =>
  addresses.cluster === 'localnet' || /127\.0\.0\.1|localhost/.test(addresses.rpcUrl);

/* -------------------------------------------------------------------------- */
/* The gateway                                                                 */
/* -------------------------------------------------------------------------- */

class MarcoChain {
  constructor() {
    this.connection = new Connection(addresses.rpcUrl,
      pacedFetch ? { commitment: 'confirmed', fetch: pacedFetch } : 'confirmed');
    this.wallet = null;
    this.publicKey = null;
    this.program = null;
    this.spotProgram = null;
  }

  get cluster() {
    return addresses.cluster;
  }

  get connected() {
    return this.publicKey !== null;
  }

  /** Base-58 address, or a short display form for the UI. */
  get address() {
    return this.publicKey?.toBase58() ?? null;
  }

  get shortAddress() {
    return this.publicKey ? shorten(this.publicKey.toBase58()) : null;
  }

  /** Which wallet kinds this environment can actually offer. */
  available() {
    return [injectedWallet(), devWallet()].filter(Boolean).map((w) => w.kind);
  }

  async connect(preferred) {
    const candidates = [injectedWallet(), devWallet()].filter(Boolean);
    const chosen = preferred
      ? candidates.find((w) => w.kind === preferred)
      : candidates[0];

    if (!chosen) {
      throw new Error(
        isLocalCluster()
          ? 'No wallet available.'
          : 'No Solana wallet found. Install Phantom, Solflare or Backpack.',
      );
    }

    this.publicKey = await chosen.connect();
    this.wallet = chosen;

    // The provider signs reads too, but every *write* below goes through the
    // wallet — the provider is never given a key it could sign with alone.
    const provider = new AnchorProvider(
      this.connection,
      {
        publicKey: this.publicKey,
        signTransaction: (tx) => chosen.signTransaction(tx),
        signAllTransactions: (txs) => chosen.signAllTransactions(txs),
      },
      { commitment: 'confirmed' },
    );
    this.program = new Program(vaultIdl, provider);
    this.spotProgram = new Program(spotIdl, provider);
    this.futuresProgram = new Program(futuresIdl, provider);

    return { address: this.address, short: this.shortAddress, kind: chosen.kind };
  }

  async disconnect() {
    await this.wallet?.disconnect();
    this.wallet = null;
    this.publicKey = null;
    this.program = null;
    this.spotProgram = null;
    this.futuresProgram = null;
  }

  /* ---- Reads ------------------------------------------------------------ */

  /** Live vault state, or null when no such vault exists on this cluster. */
  async getVault(vaultId) {
    const address = vaultPda(vaultId);
    const raw = await this.fetchVault(address);
    if (!raw) return null;

    const phase = PHASES[Object.keys(raw.phase)[0]] ?? 'Scheduled';
    return {
      vaultId,
      address: address.toBase58(),
      phase,
      // Gross deposits — what the cap counts and what left holders' wallets.
      totalDeposits: fromBase(raw.totalDeposits),
      // Net of the upfront fee: the claim tokens actually outstanding.
      totalShares: fromBase(raw.totalShares),
      cap: fromBase(raw.depositCap),
      minDeposit: fromBase(raw.minDeposit),
      feeBps: Number(raw.feeBps),
      // Fee timing. false = charged at deposit (tokens are net); true = charged
      // at redemption (deposit mints 1:1 gross, the fee comes off the payout).
      feeAtExit: Boolean(raw.feeAtExit),
      redeemable: fromBase(raw.redeemableAmount),
      fundingDeadline: Number(raw.fundingDeadline) * 1000,
      acceptingDeposits: phase === 'Funding' && !raw.frozen,
      claimable: phase === 'Claimable' || phase === 'Winding',
    };
  }

  /** The connected wallet's position, read from its BuyerState PDA. */
  async getPosition(vaultId) {
    if (!this.connected) return null;
    const vault = vaultPda(vaultId);

    let raw = null;
    try {
      raw = await this.program.account.buyerState.fetch(buyerStatePda(vault, this.publicKey));
    } catch (error) {
      /* Only a missing account means "you hold nothing". Any other failure —
         and on a public devnet RPC that is usually a 429 — is unknown, not
         zero. Reporting it as zero told a holder of 3,666 tokens that they had
         none, pre-filled the redeem field with 0 and left them unable to
         redeem. Throw, so the caller can say it does not know. */
      const missing = /does not exist|could not find/i.test(String(error?.message ?? ''));
      if (missing) return { deposited: 0, shares: 0, redeemed: 0, feePaid: 0 };
      throw error;
    }

    // Held tokens are minted less redeemed — the on-chain record, not a
    // running total the page keeps for itself.
    return {
      deposited: fromBase(raw.depositAmount),
      shares: fromBase(raw.sharesMinted) - fromBase(raw.sharesRedeemed),
      redeemed: fromBase(raw.usdcRedeemed),
      feePaid: fromBase(raw.entryFeePaid),
    };
  }

  /** The wallet's spendable USDC. */
  async getUsdcBalance() {
    if (!this.connected) return 0;
    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT, this.publicKey);
      const account = await getAccount(this.connection, ata);
      return Number(account.amount) / 10 ** DECIMALS;
    } catch {
      return 0;
    }
  }

  /**
   * Recent subscriptions into a vault, newest first.
   *
   * Signatures come from the vault PDA rather than the program id: Solana's
   * address-signature index covers the accounts a transaction touches, and a
   * program id is not reliably among them. The vault PDA is writable in every
   * holder instruction, so it sees them all.
   *
   * What comes back is a window, not an archive — the RPC keeps only recent
   * history, so this is the right shape for "what just happened" and the wrong
   * shape for an audit. Returns [] on any failure, including the rate limits a
   * public devnet RPC hands out freely.
   */
  /**
   * This wallet's own history against one vault — every deposit and every
   * redemption, newest first.
   *
   * Read from the holder's BuyerState PDA rather than the vault's: only this
   * holder's transactions ever touch it, so the signature list needs no
   * filtering and stays short even on a vault with thousands of subscribers.
   */
  async myHistory(vaultId, { limit = 20 } = {}) {
    if (!this.connected) return [];
    const vault = vaultPda(vaultId);
    const buyer = buyerStatePda(vault, this.publicKey);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The public devnet RPC throttles hard, and this is the heaviest read on
    // the page. web3.js retries a 429 a few times and then throws; this adds a
    // patient outer layer so a transient throttle does not lose the whole vault.
    const retry = async (fn) => {
      let err;
      // Patient enough to actually succeed against a throttled devnet RPC — too
      // few tries and the vault gets dropped and the list comes up empty. It can
      // afford to be: the slow work happens in the background preload, and the
      // open reads the cache. Only a genuinely cold open waits on this.
      for (let i = 0; i < 6; i += 1) {
        try { return await fn(); } catch (e) { err = e; await sleep(300 * (i + 1)); }
      }
      throw err;
    };

    const signatures = await retry(() => this.connection.getSignaturesForAddress(buyer, { limit }));
    const confirmed = signatures.filter((s) => !s.err).map((s) => s.signature);
    if (!confirmed.length) return [];

    const parser = new EventParser(
      VAULT_PROGRAM_ID,
      (this.program ?? this.readOnlyProgram()).coder,
    );

    const out = [];
    const parse = (sig, tx) => {
      const logs = tx?.meta?.logMessages;
      if (!logs) return;
      const at = tx.blockTime ? tx.blockTime * 1000 : null;
      // Anchor lower-cases the leading character, so DepositMade/ClaimMade
      // arrive as depositMade/claimMade. Field names are the IDL's, camel-cased
      // by the coder: DepositMade.accepted is this deposit's amount and mints
      // 1:1, so it is both the USDC in and the tokens out; ClaimMade carries
      // shares_burned and usdc_paid.
      for (const event of parser.parseLogs(logs)) {
        const d = event.data ?? {};
        if (event.name === 'depositMade')
          out.push({ kind: 'Subscribed', signature: sig, at,
            amount: fromBase(d.accepted), tokens: fromBase(d.accepted) });
        else if (event.name === 'claimMade')
          out.push({ kind: 'Redeemed', signature: sig, at,
            amount: fromBase(d.usdcPaid ?? d.usdc_paid),
            tokens: fromBase(d.sharesBurned ?? d.shares_burned) });
      }
    };

    // A small concurrency cap, not one-at-a-time and not the whole batch. The
    // batch of N went out as N calls at once and 429'd; one-at-a-time got
    // through but crawled. A few in flight is fast and the RPC tolerates it —
    // and a single tx that will not load is skipped, not fatal.
    let next = 0;
    const worker = async () => {
      while (next < confirmed.length) {
        const sig = confirmed[next]; next += 1;
        try {
          const tx = await retry(() => this.connection.getTransaction(sig, {
            commitment: 'confirmed', maxSupportedTransactionVersion: 0,
          }));
          parse(sig, tx);
        } catch { /* skip this one */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, confirmed.length) }, worker));
    return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }

  /**
   * The cheap half of the history read, split out so the caller can stream.
   * getSignaturesForAddress is a single RPC call and already carries blockTime,
   * so the caller can merge signatures across vaults and fetch them newest-first
   * — one heavy getTransaction at a time — rather than blocking the whole list
   * on the slowest vault. Returns `[{ signature, at }]`, most recent first.
   */
  async mySignatures(vaultId, { limit = 20 } = {}) {
    if (!this.connected) return [];
    const buyer = buyerStatePda(vaultPda(vaultId), this.publicKey);
    const sigs = await retryRpc(() => this.connection.getSignaturesForAddress(buyer, { limit }));
    return sigs
      .filter((s) => !s.err)
      .map((s) => ({ signature: s.signature, at: s.blockTime ? s.blockTime * 1000 : null }))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }

  /**
   * The heavy half: fetch and decode one transaction into its history rows. A
   * deposit or claim decodes to a single row; anything else decodes to none.
   * Split from mySignatures so the caller can pace these one at a time and
   * render each as it lands — the gentlest pattern on a throttled RPC.
   */
  async parseTx(signature) {
    const tx = await retryRpc(() => this.connection.getTransaction(signature, {
      commitment: 'confirmed', maxSupportedTransactionVersion: 0,
    }));
    const logs = tx?.meta?.logMessages;
    if (!logs) return [];
    const at = tx.blockTime ? tx.blockTime * 1000 : null;
    const parser = new EventParser(
      VAULT_PROGRAM_ID,
      (this.program ?? this.readOnlyProgram()).coder,
    );
    const out = [];
    // Anchor lower-cases the leading character, so DepositMade/ClaimMade arrive
    // as depositMade/claimMade. DepositMade.accepted mints 1:1, so it is both the
    // USDC in and the tokens out; ClaimMade carries shares_burned and usdc_paid.
    for (const event of parser.parseLogs(logs)) {
      const d = event.data ?? {};
      if (event.name === 'depositMade')
        out.push({ kind: 'Subscribed', signature, at,
          amount: fromBase(d.accepted), tokens: fromBase(d.accepted) });
      else if (event.name === 'claimMade')
        out.push({ kind: 'Redeemed', signature, at,
          amount: fromBase(d.usdcPaid ?? d.usdc_paid),
          tokens: fromBase(d.sharesBurned ?? d.shares_burned) });
    }
    return out;
  }

  async recentDeposits(vaultId, { limit = 10 } = {}) {
    try {
      const vault = vaultPda(vaultId);
      const signatures = await this.connection.getSignaturesForAddress(vault, { limit });
      const confirmed = signatures.filter((s) => !s.err).map((s) => s.signature);
      if (!confirmed.length) return [];

      const parser = new EventParser(
        VAULT_PROGRAM_ID,
        (this.program ?? this.readOnlyProgram()).coder,
      );
      // Decode one transaction into this vault's deposit record, or null if it
      // carried no deposit for this vault. No errorOnDecodeFailure, since a
      // deposit transaction also emits SPL token logs the parser cannot decode;
      // Anchor lower-cases the event name, so `DepositMade` arrives `depositMade`.
      const decode = (tx, signature) => {
        const logs = tx?.meta?.logMessages;
        if (!logs) return null;
        for (const event of parser.parseLogs(logs)) {
          if (event.name !== 'depositMade') continue;
          const data = event.data;
          if (String(data.vaultId ?? data.vault_id) !== vaultId) continue;
          return {
            signature,
            wallet: (data.depositor ?? '').toString(),
            // `accepted` is what the program actually took, not the intent, when
            // a deposit is partially filled against the cap.
            amount: fromBase(data.accepted),
            totalDeposits: fromBase(data.totalDeposits ?? data.total_deposits),
            at: tx.blockTime ? tx.blockTime * 1000 : null,
          };
        }
        return null;
      };

      // A batched getTransactions is a JSON-RPC batch, which shared tiers reject
      // (Helius free returns 403 "batch requests are only available for paid
      // plans"), so it is one getTransaction per signature. Cached signatures
      // resolve with no round trip; the rest are fetched a few in flight (the
      // shared pace keeps the burst under the rate limit) and their decode is
      // written back, so the next landing reads the feed from localStorage.
      const recs = new Array(confirmed.length);
      let next = 0;
      const worker = async () => {
        while (next < confirmed.length) {
          const i = next; next += 1;
          const sig = confirmed[i];
          const cached = rdGet(vaultId, sig);
          if (cached !== undefined) { recs[i] = cached; continue; }
          try {
            const tx = await retryRpc(() => this.connection.getTransaction(sig, {
              commitment: 'confirmed', maxSupportedTransactionVersion: 0,
            }));
            const rec = decode(tx, sig);
            rdSet(vaultId, sig, rec);
            recs[i] = rec;
          } catch { recs[i] = null; /* skip; a failed fetch is not cached */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, confirmed.length) }, worker));

      // Signature order follows the RPC's index, not the clock; sort so "newest
      // first" is true rather than usually true.
      return recs.filter(Boolean).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    } catch {
      return [];
    }
  }

  async fetchVault(address) {
    try {
      return await (this.program ?? this.readOnlyProgram()).account.vault.fetch(address);
    } catch {
      return null;
    }
  }

  /** Reads work without a wallet; vault state is public. */
  readOnlyProgram() {
    return new Program(vaultIdl, {
      connection: this.connection,
      publicKey: PublicKey.default,
    });
  }

  /* ---- Writes — holder-signed, always ------------------------------------ */

  /**
   * Subscribe USDC.
   *
   * Partial-fill is the program's behaviour, not this function's: it accepts
   * `min(amount, cap remaining, per-address remaining)` and pulls only that.
   * The returned position is re-read from chain rather than predicted.
   */
  async deposit(vaultId, amount) {
    this.requireWallet();
    const vault = vaultPda(vaultId);
    const shareMint = shareMintPda(vault);

    const depositorUsdc = await getAssociatedTokenAddress(USDC_MINT, this.publicKey);
    const depositorShares = await getAssociatedTokenAddress(shareMint, this.publicKey);
    const vaultUsdc = await getAssociatedTokenAddress(USDC_MINT, vault, true);

    const preInstructions = [];
    if (!(await this.accountExists(depositorShares))) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          this.publicKey,
          depositorShares,
          this.publicKey,
          shareMint,
        ),
      );
    }

    const signature = await this.program.methods
      .deposit(toBase(amount))
      .accountsPartial({
        vault,
        buyerState: buyerStatePda(vault, this.publicKey),
        shareMint,
        depositorUsdc,
        vaultUsdc,
        depositorShares,
        depositor: this.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .rpc();

    return { signature, position: await this.getPosition(vaultId) };
  }

  /** Burn claim tokens for pro-rata USDC. */
  async claim(vaultId, shares) {
    this.requireWallet();
    const vault = vaultPda(vaultId);
    const shareMint = shareMintPda(vault);

    const signature = await this.program.methods
      .claim(toBase(shares))
      .accountsPartial({
        vault,
        buyerState: buyerStatePda(vault, this.publicKey),
        shareMint,
        claimantShares: await getAssociatedTokenAddress(shareMint, this.publicKey),
        vaultUsdc: await getAssociatedTokenAddress(USDC_MINT, vault, true),
        claimantUsdc: await getAssociatedTokenAddress(USDC_MINT, this.publicKey),
        claimant: this.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return { signature, position: await this.getPosition(vaultId) };
  }

  async accountExists(address) {
    return (await this.connection.getAccountInfo(address)) !== null;
  }

  requireWallet() {
    if (!this.connected) throw new Error('Connect a wallet first.');
  }

  /* ======================================================================== */
  /* marco-spot — the same trust rule: orders are signed by the trader's own  */
  /* wallet. The operator can fill or cancel a deployed order, but it can     */
  /* never place one, because placement IS the escrow of the trader's money.  */
  /* ======================================================================== */

  readOnlySpot() {
    return new Program(spotIdl, { connection: this.connection, publicKey: PublicKey.default });
  }

  spot() {
    return this.spotProgram ?? this.readOnlySpot();
  }

  /** Live market state, or null when no such market exists on this cluster. */
  async getSpotMarket(ticker) {
    const address = marketPda(ticker);
    let raw = null;
    try {
      raw = await this.spot().account.market.fetch(address);
    } catch {
      return null;
    }
    const status = Object.keys(raw.status)[0]; // active | paused | closed
    return {
      ticker,
      address: address.toBase58(),
      status,
      active: status === 'active',
      feeBps: Number(raw.feeBps),
      orderSeq: Number(raw.orderSeq.toString()),
      minOrder: fromBase(raw.minOrderUsdc),
      maxOrder: fromBase(raw.maxOrderUsdc),
      // Position tokens outstanding == shares in custody. The 1:1 claim.
      supply: fromBase(raw.totalSharesOutstanding),
      escrowed: fromBase(raw.usdcEscrowed),
      transferLock: Boolean(raw.transferLock),
    };
  }

  /** Is the connected wallet registered and eligible to trade? */
  async getTraderStatus() {
    if (!this.connected) return { registered: false, eligible: false };
    try {
      const raw = await this.spot().account.traderAccount.fetch(
        traderAccountPda(this.publicKey),
      );
      return { registered: true, eligible: Boolean(raw.eligible) };
    } catch {
      return { registered: false, eligible: false };
    }
  }

  /**
   * The wallet's position in a market: live token balance plus the average
   * cost basis from the on-chain Holding record (lifetime USDC spent over
   * shares bought — the program's own running history, not a page total).
   */
  async getSpotPosition(ticker) {
    const empty = { tokens: 0, frozen: false, avgCost: 0 };
    if (!this.connected) return empty;
    const market = marketPda(ticker);
    let tokens = 0, frozen = false, avgCost = 0;
    try {
      const mint = positionMintPda(market);
      const ata = await getAssociatedTokenAddress(mint, this.publicKey);
      const account = await getAccount(this.connection, ata);
      tokens = Number(account.amount) / 10 ** DECIMALS;
      frozen = account.isFrozen;
    } catch { /* no token account yet */ }
    try {
      const h = await this.spot().account.holding.fetch(holdingPda(market, this.publicKey));
      const bought = Number(h.sharesBought.toString());
      if (bought > 0) avgCost = Number(h.usdcSpent.toString()) / bought;
    } catch { /* no holding yet */ }
    return { tokens, frozen, avgCost };
  }

  /** The wallet's orders on a market, newest first. */
  async getMyOrders(ticker) {
    if (!this.connected) return [];
    const market = marketPda(ticker);
    // Order layout: 8 disc + 1 bump, market at 9, trader at 41.
    const found = await this.spot().account.order.all([
      { memcmp: { offset: 9, bytes: market.toBase58() } },
      { memcmp: { offset: 41, bytes: this.publicKey.toBase58() } },
    ]);
    return found
      .map(({ account: o }) => ({
        orderId: Number(o.orderId.toString()),
        side: Object.keys(o.side)[0],
        status: Object.keys(o.status)[0],
        usdc: fromBase(o.usdcAmount),
        shares: fromBase(o.sharesAmount),
        limitPrice: fromBase(o.limitPrice),
        executionPrice: fromBase(o.executionPrice),
        feePaid: fromBase(o.feePaid),
      }))
      .sort((a, b) => b.orderId - a.orderId);
  }

  /**
   * Escrow USDC and open a buy order.
   *
   * The trader sets both protections the program demands: `limitPrice` caps
   * what each share may cost, `minSharesOut` floors how many must arrive.
   * `orderId` must equal the market's live counter, so it is read fresh and
   * the call retried once if another order lands in between.
   */
  async spotBuy(ticker, usdcAmount, limitPrice, minSharesOut) {
    this.requireWallet();
    const market = marketPda(ticker);
    const positionMint = positionMintPda(market);
    const traderUsdc = await getAssociatedTokenAddress(USDC_MINT, this.publicKey);
    const traderPosition = await getAssociatedTokenAddress(positionMint, this.publicKey);

    // The operator's confirm_buy mints into the trader's position account and
    // looks it up rather than creating it, so make sure it exists now — the
    // trader pays the rent for their own account, nobody else's.
    const preInstructions = [];
    if (!(await this.accountExists(traderPosition))) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          this.publicKey, traderPosition, this.publicKey, positionMint,
        ),
      );
    }

    const attempt = async () => {
      const m = await this.spot().account.market.fetch(market);
      const orderId = new BN(m.orderSeq.toString());
      const signature = await this.spotProgram.methods
        .placeBuy(orderId, toBase(usdcAmount), toBase(limitPrice), toBase(minSharesOut))
        .accountsPartial({
          market,
          order: orderPda(market, orderId),
          holding: holdingPda(market, this.publicKey),
          traderAccount: traderAccountPda(this.publicKey),
          traderUsdc,
          marketUsdc: marketUsdcPda(market),
          trader: this.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions(preInstructions)
        .rpc();
      return { signature, orderId: Number(orderId) };
    };

    try {
      return await attempt();
    } catch (e) {
      // Someone else's order took our sequence slot; one fresh re-read is the
      // fix. Any other failure is real and surfaces to the caller.
      if (/InvalidParameter|already in use|seeds/i.test(e.message ?? '')) return attempt();
      throw e;
    }
  }

  /** Escrow position tokens and open a sell order. */
  async spotSell(ticker, shares, limitPrice) {
    this.requireWallet();
    const market = marketPda(ticker);
    const positionMint = positionMintPda(market);
    const traderPosition = await getAssociatedTokenAddress(positionMint, this.publicKey);

    const attempt = async () => {
      const m = await this.spot().account.market.fetch(market);
      const orderId = new BN(m.orderSeq.toString());
      const signature = await this.spotProgram.methods
        .placeSell(orderId, toBase(shares), toBase(limitPrice))
        .accountsPartial({
          market,
          order: orderPda(market, orderId),
          holding: holdingPda(market, this.publicKey),
          traderAccount: traderAccountPda(this.publicKey),
          positionMint,
          traderPosition,
          positionEscrow: positionEscrowPda(market),
          trader: this.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return { signature, orderId: Number(orderId) };
    };

    try {
      return await attempt();
    } catch (e) {
      if (/InvalidParameter|already in use|seeds/i.test(e.message ?? '')) return attempt();
      throw e;
    }
  }

  /**
   * Cancel one of the wallet's own pending orders. A pending buy refunds the
   * escrowed USDC in full; a pending sell returns the escrowed tokens intact.
   */
  async cancelSpotOrder(ticker, orderId) {
    this.requireWallet();
    const market = marketPda(ticker);
    const order = orderPda(market, orderId);
    const raw = await this.spotProgram.account.order.fetch(order);
    const side = Object.keys(raw.side)[0];

    if (side === 'buy') {
      const traderUsdc = await getAssociatedTokenAddress(USDC_MINT, this.publicKey);
      const signature = await this.spotProgram.methods
        .cancelBuy()
        .accountsPartial({
          market, order,
          marketUsdc: marketUsdcPda(market),
          traderUsdc,
          signer: this.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      return { signature };
    }

    const positionMint = positionMintPda(market);
    const traderPosition = await getAssociatedTokenAddress(positionMint, this.publicKey);
    const signature = await this.spotProgram.methods
      .cancelSell()
      .accountsPartial({
        market, order,
        positionMint,
        positionEscrow: positionEscrowPda(market),
        traderPosition,
        signer: this.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    return { signature };
  }
}

/* ========================================================================== */
/* marco-futures — dated valuation futures. Unlike the vault and spot, this   */
/* program holds trader margin and is the counterparty; every position change */
/* is still signed by the trader's own wallet, and fills happen in the same  */
/* transaction against the vAMM — there is no operator step.                 */
/* ========================================================================== */

Object.assign(MarcoChain.prototype, {
  futures() {
    return this.futuresProgram
      ?? new Program(futuresIdl, { connection: this.connection, publicKey: PublicKey.default });
  },

  /** The configured futures market, or null when it is not on this cluster. */
  futuresMarketId() {
    return addresses.futures?.marketId ?? null;
  },

  /** Live market state: the vAMM mark, open interest, insurance and terms. */
  async getFuturesMarket(id = this.futuresMarketId()) {
    if (!id) return null;
    const address = futMarketPda(id);
    let m;
    try { m = await this.futures().account.market.fetch(address); } catch { return null; }
    let insurance = 0;
    try { insurance = Number((await getAccount(this.connection, futInsurancePda(address))).amount) / 10 ** DECIMALS; }
    catch { /* unreadable — leave 0 */ }
    const q = BigInt(m.quoteReserve.toString()), b = BigInt(m.baseReserve.toString());
    return {
      id, address: address.toBase58(),
      status: Object.keys(m.status)[0],
      mark: Number((q * 1_000_000n) / b) / 1e6,       // $B
      anchor: fromIndex(m.anchorPrice),
      quoteReserve: Number(q) / 10 ** DECIMALS,
      baseReserve: Number(b) / 1e6,
      maxLeverage: m.maxLeverage,
      maintenanceMarginBps: m.maintenanceMarginBps,
      takerFeeBps: m.takerFeeBps,
      liquidationFeeBps: m.liquidationFeeBps,
      longOI: fromBase(m.longOpenNotional),
      shortOI: fromBase(m.shortOpenNotional),
      totalCollateral: fromBase(m.totalCollateral),
      positions: Number(m.positionCount.toString()),
      settlementPrice: fromIndex(m.settlementPrice),
      expiry: Number(m.expiryTs.toString()) * 1000,
      insurance,
    };
  },

  /** The wallet's position, or null when it has none (or is flat). */
  async getFuturesPosition(id = this.futuresMarketId()) {
    if (!this.connected || !id) return null;
    let p;
    try { p = await this.futures().account.position.fetch(futPositionPda(futMarketPda(id), this.publicKey)); }
    catch { return null; }
    const base = Number(p.baseSize.toString()) / 1e6;
    return {
      side: base > 0 ? 'long' : base < 0 ? 'short' : null,
      base,                                        // $B of valuation exposure, signed
      margin: fromBase(p.margin),
      openNotional: fromBase(p.openNotional),
      realizedPnl: Number(p.realizedPnl.toString()) / 10 ** DECIMALS,
      updatedAt: Number(p.lastUpdated.toString()) * 1000,
    };
  },

  /**
   * Post margin and open (or add to) a position, in one transaction:
   * deposit_collateral then open_position. `limitPrice` ($B, 0 to skip)
   * bounds the average fill against vAMM impact.
   */
  async futuresOpen(side, marginUsdc, notionalUsdc, limitPrice = 0, id = this.futuresMarketId()) {
    this.requireWallet();
    const market = futMarketPda(id);
    const position = futPositionPda(market, this.publicKey);
    const collateralVault = futCollateralPda(market);
    const ownerUsdc = await getAssociatedTokenAddress(USDC_MINT, this.publicKey);
    const pre = [];
    if (marginUsdc > 0) {
      pre.push(await this.futuresProgram.methods.depositCollateral(toBase(marginUsdc)).accountsPartial({
        market, position, collateralVault, ownerUsdc, owner: this.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).instruction());
    }
    const signature = await this.futuresProgram.methods
      .openPosition(side === 'long', toBase(notionalUsdc), new BN(Math.round(limitPrice * 1e6)))
      .accountsPartial({
        config: futConfigPda(), market, position, collateralVault,
        insuranceVault: futInsurancePda(market), owner: this.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions(pre)
      .rpc();
    return { signature };
  },

  /** Close the whole position; realized PnL settles and the margin is paid back. */
  async futuresClose(limitPrice = 0, id = this.futuresMarketId()) {
    this.requireWallet();
    const market = futMarketPda(id);
    const signature = await this.futuresProgram.methods
      .closePosition(new BN(0), new BN(Math.round(limitPrice * 1e6)))
      .accountsPartial({
        market, position: futPositionPda(market, this.publicKey),
        collateralVault: futCollateralPda(market), insuranceVault: futInsurancePda(market),
        ownerUsdc: await getAssociatedTokenAddress(USDC_MINT, this.publicKey),
        owner: this.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    return { signature };
  },

  /** Recent transactions on the futures market — the tape, newest first. */
  async futuresActivity(limit = 20, id = this.futuresMarketId()) {
    if (!id) return [];
    const sigs = await this.connection.getSignaturesForAddress(futMarketPda(id), { limit });
    return sigs.filter((s) => !s.err).map((s) => ({ signature: s.signature, time: (s.blockTime ?? 0) * 1000 }));
  },

  /**
   * Every spot holding the wallet has, across all markets, in two RPC calls:
   * one for its token accounts, one for its Holding records (cost basis).
   * Returns { ticker: { tokens, avgCost } } for tickers with a balance.
   */
  async getSpotPortfolio() {
    if (!this.connected) return {};
    const tickers = Object.keys(addresses.spot ?? {});
    const byMint = new Map(tickers.map((t) => [positionMintPda(marketPda(t)).toBase58(), t]));
    const out = {};
    const { value } = await this.connection.getParsedTokenAccountsByOwner(this.publicKey, { programId: TOKEN_PROGRAM_ID });
    for (const { account } of value) {
      const info = account.data.parsed.info, t = byMint.get(info.mint);
      if (t) out[t] = { tokens: Number(info.tokenAmount.uiAmount || 0), avgCost: 0 };
    }
    const held = Object.keys(out);
    if (held.length) {
      const infos = await this.connection.getMultipleAccountsInfo(held.map((t) => holdingPda(marketPda(t), this.publicKey)));
      infos.forEach((acc, i) => {
        if (!acc) return;
        const h = this.spot().coder.accounts.decode('holding', acc.data);
        const bought = Number(h.sharesBought.toString());
        if (bought > 0) out[held[i]].avgCost = Number(h.usdcSpent.toString()) / bought;
      });
    }
    return out;
  },
});

const instance = new MarcoChain();
instance.addresses = addresses;
globalThis.MarcoChain = instance;

export default instance;
