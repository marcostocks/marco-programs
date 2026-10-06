/**
 * Devnet auto-operator: the missing half of a browser order, on a loop.
 *
 * Watches every listed marco-spot market and, for every order a holder has placed:
 *
 *   Pending BUY   → deploy_buy   (escrow → conversion partner, spread kept)
 *                 → confirm_buy  (SIMULATED custodian attestation; mints the
 *                                 trader's locked position tokens)
 *   Pending SELL  → mint the sale proceeds into the market account
 *                   (simulating the broker's return wire), then
 *                 → settle_sell  (burns escrowed tokens, pays net of spread)
 *
 * The attestation is a mock: a synthetic position reference and a hash of a
 * synthetic statement. That is exactly the boundary where a real custodian
 * plugs in — everything else (the writes, their ordering, the idempotency) is
 * the production adapter. Execution is at the price the app quoted (its limit
 * less the 2% slippage allowance it adds), inside the trader's limit, so every
 * program-side protection stays honest.
 *
 * Idempotent by on-chain state via the adapter, so restarts and races are
 * safe. Public-RPC 429s are retried with backoff.
 *
 *   npm run operator:devnet          # loop every 20s
 *   npx tsx scripts/auto-operator-devnet.ts --once   # single pass
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAccount, mintTo } from '@solana/spl-token';

import { SolanaChain } from '../src/adapters/solana/chain.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { systemClock } from '../src/domain/clock.js';
import { money, quantity } from '../src/domain/money.js';
import { marketPda, marketUsdcPda, orderPda } from '../src/adapters/solana/pdas.js';
import { ConsoleLogger } from '../src/support/logger.js';

const POLL_MS = 20_000;
const ONCE = process.argv.includes('--once');

// web3.js's confirmTransaction surfaces websocket/RPC failures as unhandled
// rejections outside any await chain, which Node treats as fatal. On the
// public devnet RPC those are routine; log and keep the loop alive.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.log(`[${new Date().toISOString().slice(11, 19)}] unhandled RPC rejection (survived): ${msg.slice(0, 120)}`);
});

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))),
);
const artifacts = loadArtifacts();
// Every marco-spot market the platform lists (addresses.spot, written by
// scripts/devnet/init-spot-markets-devnet.js); 0700.HK alone before that existed.
const TICKERS = Object.keys((artifacts.addresses as { spot?: Record<string, string> }).spot ?? { '0700.HK': '' });
const rpcUrl = artifacts.addresses.rpcUrl;
const conn = new Connection(rpcUrl, 'confirmed');
const chain = new SolanaChain({
  clock: systemClock,
  logger: new ConsoleLogger('warn'),
  rpcUrl,
  operator: kp,
  admin: kp,
  artifacts,
});
const spotRead = new Program(
  artifacts.spotIdl,
  new AnchorProvider(conn, new Wallet(kp), { commitment: 'confirmed' }),
);

const ui = (n: bigint | number) => (Number(n) / 1e6).toFixed(2);
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg: string) => console.log(`[${stamp()}] ${msg}`);

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 6): Promise<T> {
  let delay = 700;
  for (let i = 1; ; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const transient = /429|Too Many|fetch failed|ECONN|ETIMEDOUT|blockhash|Node is behind|50[234]/i.test(msg);
      if (!transient || i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 6000);
    }
  }
}

/** The simulated custodian: a position reference and a statement fingerprint. */
function mockAttestation(TICKER: string, orderId: string, sharesUnits: bigint, priceUnits: bigint) {
  const custodyReference = `POS-DEV-${orderId}-${Date.now() % 1e6}`;
  const statement = JSON.stringify({
    custodian: 'MOCK-CUSTODY-01',
    account: 'MARCO-CUSTODY-01',
    ticker: TICKER,
    orderId,
    shares: sharesUnits.toString(),
    price: priceUnits.toString(),
    settledAt: new Date().toISOString(),
  });
  const documentHash = createHash('sha256').update(statement).digest('hex');
  return { custodyReference, documentHash };
}

async function pass(TICKER: string): Promise<void> {
  const market = marketPda(artifacts.spotProgramId, new PublicKey(artifacts.addresses.wallets.admin), TICKER);
  const raw = await withRetry('market', () => (spotRead.account as unknown as { market: { fetch(a: PublicKey): Promise<unknown> } }).market.fetch(market));
  const seq = Number((raw as { orderSeq: BN }).orderSeq.toString());

  for (let id = 0; id < seq; id += 1) {
    const order = await withRetry(`order ${id}`, () => chain.getSpotOrder(TICKER, String(id)));
    if (!order) continue;

    if (order.side === 'BUY' && order.state === 'PENDING') {
      log(`buy #${id} (${order.trader.slice(0, 8)}…): deploying ${ui(order.escrowedAmount!.amount)} USDC escrow`);
      await withRetry('deploy_buy', () => chain.deployBuy(TICKER, String(id)));

      // Re-read for the deployed amount, then attest just inside the limit.
      const deployed = await withRetry(`order ${id}`, () => chain.getSpotOrder(TICKER, String(id)));
      const raw2 = await withRetry('order raw', () =>
        (spotRead.account as { order: { fetch(a: PublicKey): Promise<unknown> } }).order.fetch(
          orderPda(artifacts.spotProgramId, market, BigInt(id)),
        ),
      );
      const deployedUnits = BigInt((raw2 as { deployedAmount: BN }).deployedAmount.toString());
      const limitUnits = deployed!.limitPrice.amount;
      // The app sets limit = quote × 1.02, so this fills at the price it quoted.
      const execUnits = (limitUnits * 100n) / 102n;
      const sharesUnits = (deployedUnits * 1_000_000n) / execUnits; // 6dp shares; notional ≤ deployed

      const { custodyReference, documentHash } = mockAttestation(TICKER, String(id), sharesUnits, execUnits);
      log(`buy #${id}: custodian attests ${ui(sharesUnits)} shares @ ${ui(execUnits)} · ref ${custodyReference}`);
      const res = await withRetry('confirm_buy', () =>
        chain.confirmBuy({
          orderId: String(id),
          ticker: TICKER,
          quantity: quantity(TICKER, sharesUnits),
          averagePrice: money('USDC', execUnits),
          custodyReference,
          documentHash,
        }),
      );
      log(`buy #${id}: FILLED — tokens minted (locked) · ${res.signature || 'already applied'}`);
    }

    if (order.side === 'SELL' && order.state === 'PENDING') {
      const sharesUnits = order.escrowedShares!.units;
      const limitUnits = order.limitPrice.amount;
      // The app sets limit = quote × 0.98, so this fills at the price it quoted.
      const execUnits = (limitUnits * 100n) / 98n;
      const proceedsUnits = (sharesUnits * execUnits) / 1_000_000n;

      // Simulate the broker's wire: the proceeds must genuinely be present as
      // UNRESERVED balance before settle_sell will pay the seller. Idempotent:
      // compute the unreserved slice the way the program does (balance minus
      // pending-buy escrow minus unswept fees) and mint only the shortfall, so
      // a crash-and-restart cannot double-fund the same settlement.
      const marketUsdc = marketUsdcPda(artifacts.spotProgramId, market);
      const m2 = (await withRetry('market raw', () => (spotRead.account as unknown as { market: { fetch(a: PublicKey): Promise<unknown> } }).market.fetch(market))) as {
        usdcEscrowed: BN; feesCollected: BN; feesSwept: BN;
      };
      const balance = BigInt((await withRetry('escrow balance', () => getAccount(conn, marketUsdc))).amount);
      const reserved = BigInt(m2.usdcEscrowed.toString())
        + BigInt(m2.feesCollected.toString()) - BigInt(m2.feesSwept.toString());
      const unreserved = balance > reserved ? balance - reserved : 0n;
      const shortfall = proceedsUnits > unreserved ? proceedsUnits - unreserved : 0n;
      log(`sell #${id} (${order.trader.slice(0, 8)}…): broker returns ${ui(proceedsUnits)} USDC for ${ui(sharesUnits)} shares${shortfall < proceedsUnits ? ` (${ui(proceedsUnits - shortfall)} already present)` : ''}`);
      if (shortfall > 0n) {
        await withRetry('wire proceeds', () =>
          mintTo(conn, kp, artifacts.usdcMint, marketUsdc, kp, shortfall),
        );
      }

      const { documentHash } = mockAttestation(TICKER, String(id), sharesUnits, execUnits);
      const res = await withRetry('settle_sell', () =>
        chain.settleSell({
          orderId: String(id),
          ticker: TICKER,
          grossProceeds: money('USDC', proceedsUnits),
          quantity: quantity(TICKER, sharesUnits),
          executionPrice: money('USDC', execUnits),
          documentHash,
        }),
      );
      log(`sell #${id}: SETTLED — escrowed tokens burned, seller paid net of spread · ${res.signature || 'already applied'}`);
    }
  }
}

/* One sweep at a time. A trigger that arrives mid-sweep queues its markets for
   exactly one more round, so a burst of orders never stacks overlapping passes
   against a rate-limited RPC. */
let sweeping = false;
const queued = new Set<string>();
async function sweep(tickers: string[] = TICKERS): Promise<void> {
  tickers.forEach((t) => queued.add(t));
  if (sweeping) return;
  sweeping = true;
  try {
    while (queued.size) {
      const round = TICKERS.filter((t) => queued.has(t));
      queued.clear();
      for (const ticker of round) {
        try {
          await pass(ticker);
        } catch (error) {
          log(`${ticker} pass failed: ${error instanceof Error ? error.message.slice(0, 140) : error}`);
        }
      }
    }
  } finally {
    sweeping = false;
  }
}

/* Every market's order counter in ONE call. A market whose counter moved has a
   new order, so only that market is swept — cheap enough to run every few
   seconds where a full sweep (an RPC per order) is not. */
const admin = new PublicKey(artifacts.addresses.wallets.admin);
const marketKeys = TICKERS.map((t) => marketPda(artifacts.spotProgramId, admin, t));
const lastSeq = new Map<string, number>();
async function newOrders(): Promise<string[]> {
  const infos = await conn.getMultipleAccountsInfo(marketKeys);
  const moved: string[] = [];
  infos.forEach((info, i) => {
    if (!info) return;
    const m = spotRead.coder.accounts.decode('market', info.data) as { orderSeq: BN };
    const seq = Number(m.orderSeq.toString()), t = TICKERS[i]!;
    if (lastSeq.has(t) && seq !== lastSeq.get(t)) moved.push(t);
    lastSeq.set(t, seq);
  });
  return moved;
}

const WATCH_MS = 3_000;
async function main(): Promise<void> {
  log(`auto-operator on ${TICKERS.join(', ')} · ${rpcUrl} · ${ONCE ? 'single pass' : `new orders within ~${WATCH_MS / 1000}s, full sweep every ${POLL_MS / 1000}s`}`);
  log('custodian attestations are SIMULATED — this is the seam a real custodian replaces');
  if (ONCE) return sweep();

  // Fastest path: the program logs each instruction, so a confirmed
  // PlaceBuy/PlaceSell can trigger a sweep within a second. Public and free-tier
  // RPCs throttle websockets, though, so this is a bonus, not the mechanism.
  try {
    conn.onLogs(artifacts.spotProgramId, (entry) => {
      if (entry.err || !entry.logs.some((l) => /Instruction: Place(Buy|Sell)/.test(l))) return;
      log(`order seen in ${entry.signature.slice(0, 8)}… — filling`);
      void sweep();
    }, 'confirmed');
  } catch { /* no websocket — the watcher below covers it */ }

  // The mechanism: watch the order counters, sweep the markets that moved.
  await newOrders().catch(() => []);
  setInterval(() => {
    newOrders().then((moved) => {
      if (!moved.length) return;
      log(`new order on ${moved.join(', ')} — filling`);
      void sweep(moved);
    }).catch(() => { /* throttled — next tick */ });
  }, WATCH_MS);

  // Backstop: a full sweep, for anything left behind by a failed pass.
  for (;;) {
    await sweep();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
