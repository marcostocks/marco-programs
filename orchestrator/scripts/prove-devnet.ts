/**
 * Prove the orchestrator drives the LIVE devnet programs.
 *
 * Boots the real composition root with the chain port pointed at devnet and the
 * counterparties mocked (the posture bootstrap.ts explicitly allows), then:
 *
 *   1. reads the live market and a live vault through the real adapter;
 *   2. seeds the watcher cursor just before a real on-chain deposit and polls —
 *      the ChainWatcher turns that deposit into a VAULT_SUBSCRIBE intent, and a
 *      re-poll creates nothing (dedupe by signature);
 *   3. drives that vault Funding → Claimable through the adapter, replaying each
 *      transition to show idempotency-by-on-chain-state;
 *   4. asserts the ledger balances.
 *
 * Nothing here is hand-signed with raw anchor — every write goes through the
 * same SolanaChain the running service uses.
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   OPERATOR_KEYPAIR=~/.config/solana/id.json \
 *   npx tsx scripts/prove-devnet.ts [VAULT_ID]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  Connection,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { getAccount, mintTo } from '@solana/spl-token';

import { bootstrap } from '../src/bootstrap.js';
import { testConfig } from '../src/config/config.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { money, quantity } from '../src/domain/money.js';
import { vaultPda } from '../src/adapters/solana/pdas.js';

const VAULT_ID = process.argv[2] ?? 'HK-IPO-DEMO-001';
const TICKER = '0700.HK';
const fmt = (n: bigint) => (Number(n) / 1e6).toLocaleString('en-US');
const step = (n: number, t: string) => console.log(`\n${n}. ${t}`);
const ok = (t: string) => console.log(`   ✓ ${t}`);
const keypairPath = (env: string) =>
  (process.env[env] ?? '~/.config/solana/id.json').replace(/^~/, homedir());

class ProofFailure extends Error {}
const fail = (t: string): never => {
  throw new ProofFailure(t);
};

/**
 * Outer retry for the public devnet RPC, which rate-limits bursts hard. Safe
 * to wrap chain writes too: every SolanaChain method reads on-chain state first
 * and no-ops if the transition already landed, so a re-invocation after a lost
 * confirmation cannot double-apply.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 7): Promise<T> {
  let delay = 800;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const transient =
        /429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|Node is behind|blockhash|Indeterminate|50[234]|Service Unavailable|Gateway/i.test(msg);
      if (!transient || i === attempts) throw error;
      console.log(`   … ${label}: transient RPC error (attempt ${i}/${attempts}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }
  throw new Error('unreachable');
}

async function main(): Promise<void> {
  const artifacts = loadArtifacts();
  const rpcUrl = process.env.SOLANA_RPC_URL ?? artifacts.addresses.rpcUrl;
  const operatorKeypairPath = keypairPath('OPERATOR_KEYPAIR');
  const adminKeypairPath = keypairPath('ADMIN_KEYPAIR');

  // The real composition root. Only the chain port is real; the counterparties
  // are mocks because a real one would be a bank.
  const runtime = bootstrap({
    config: testConfig({
      providers: { msb: 'mock', broker: 'mock', custodian: 'mock', compliance: 'mock', chain: 'solana' },
      solana: {
        rpcUrl,
        spotProgramId: artifacts.addresses.programs.marcoSpot,
        vaultProgramId: artifacts.addresses.programs.marcoVault,
        signerKind: 'file',
        operatorKeypairPath,
        adminKeypairPath,
      },
    }),
  });
  const { chain, ledger, store } = runtime.services;
  console.log(`prove-devnet · ${artifacts.addresses.cluster} · ${rpcUrl}`);
  console.log(`chain gateway id: ${chain.id}  (expect "solana")`);
  if (chain.id !== 'solana') fail('chain gateway is not the Solana adapter');

  /* 1 ── reads through the real adapter ------------------------------------ */
  step(1, 'Read live state through the bootstrapped adapter');
  const market = await withRetry('getMarket', () => chain.getMarket(TICKER));
  if (!market) throw new ProofFailure(`no market ${TICKER} on chain`);
  ok(`market ${TICKER} · ${market.status} · fee ${market.feeBps}bps · ${fmt(market.escrowBalance.amount)} USDC escrow · ${fmt(market.positionSupply.units)} tokens outstanding`);

  const vault = await withRetry('getVault', () => chain.getVault(VAULT_ID));
  if (!vault) throw new ProofFailure(`no vault ${VAULT_ID} on chain`);
  ok(`vault ${VAULT_ID} · phase ${vault.phase} · ${fmt(vault.totalDeposits.amount)} USDC deposited · ${fmt(vault.totalShares)} claim tokens`);

  /* 2 ── the watcher turns a real deposit into an intent ------------------- */
  step(2, 'The ChainWatcher sees a real on-chain deposit and creates an intent');
  const conn = new Connection(rpcUrl, 'confirmed');
  const vaultAddress = new PublicKey(vault.vaultAddress);
  // Find the earliest signature on the vault account and seed the cursor just
  // below it, so the poll examines this vault's history (openFunding, deposit)
  // without replaying the whole cluster from slot 0.
  const sigs = await withRetry('getSignaturesForAddress', () =>
    conn.getSignaturesForAddress(vaultAddress, { limit: 50 }),
  );
  if (sigs.length === 0) fail('no signatures on the vault account');
  const earliestSlot = Math.min(...sigs.map((s) => s.slot));
  await store.cursors.set('chain:primary', { lastSignature: null, lastSlot: earliestSlot });
  ok(`seeded cursor to slot ${earliestSlot} (the vault's first signature)`);

  const result = await withRetry('watcher.poll', () => runtime.watcher.poll(6));
  const intents = await store.intents.list({});
  const subscribe = intents.find(
    (i) => i.kind === 'VAULT_SUBSCRIBE' && i.request.vaultId === VAULT_ID,
  );
  ok(`polled ${result.polled} events → created ${result.created} intents`);
  for (const i of intents) {
    ok(`  ${i.kind.padEnd(15)} ${i.request.vaultId ?? i.request.ticker ?? ''} · ${i.wallet.slice(0, 8)}… · sig ${i.source.signature.slice(0, 8)}…`);
  }
  if (!subscribe) throw new ProofFailure(`no VAULT_SUBSCRIBE intent was created for ${VAULT_ID}`);
  ok(`intent ${subscribe.id} born from Bob's on-chain deposit — not an HTTP call`);

  step(3, 'Re-polling the same window creates nothing (dedupe by signature)');
  await store.cursors.set('chain:primary', { lastSignature: null, lastSlot: earliestSlot });
  const replay = await withRetry('watcher.poll', () => runtime.watcher.poll(6));
  if (replay.created !== 0) fail(`replay created ${replay.created} duplicate intents`);
  ok(`${replay.polled} events re-observed, 0 duplicates`);

  /* 4 ── drive the vault to Claimable through the adapter ------------------ */
  if (vault.phase !== 'Funding') {
    ok(`vault already ${vault.phase}; skipping the drive (re-run with a Funding vault to see it)`);
  } else {
    step(4, 'Drive the vault Funding → Claimable through the adapter (idempotent)');
    const deployable = money('USDC', vault.totalShares); // net subscribed; fee stays behind

    const advance = async (name: string, call: () => Promise<{ alreadyApplied: boolean }>, expect: string) => {
      const first = await withRetry(name, call);
      if (first.alreadyApplied) fail(`${name} was already applied before this run`);
      const again = await withRetry(name, call);
      if (!again.alreadyApplied) fail(`${name} re-submitted instead of recognising it landed`);
      const s = await withRetry('getVault', () => chain.getVault(VAULT_ID));
      if (s!.phase !== expect) fail(`${name} left the vault ${s!.phase}, expected ${expect}`);
      ok(`${name.padEnd(18)}→ ${expect}  (replay: alreadyApplied ✓)`);
    };

    await advance('seal_funding', () => chain.sealFunding(VAULT_ID), 'Sealed');
    await advance('begin_sourcing', () => chain.beginSourcing(VAULT_ID), 'Sourcing');
    await advance('confirm_allocation', () => chain.confirmAllocation(VAULT_ID, deployable), 'Sourced');

    await withRetry('deploy_capital', () => chain.deployCapital(VAULT_ID, deployable));
    const deployed = await withRetry('getVault', () => chain.getVault(VAULT_ID));
    if (deployed!.phase !== 'Deployed') fail(`expected Deployed, got ${deployed!.phase}`);
    ok(`deploy_capital    → Deployed (${fmt(deployable.amount)} USDC to ${deployed!.brokerDestination.slice(0, 8)}…, immutable)`);

    await withRetry('mark_listed', () => chain.markListed(VAULT_ID, quantity(VAULT_ID, 100_000n), 0));
    ok('mark_listed       → Live');
    const gross = money('USDC', (vault.totalDeposits.amount * 130n) / 100n);
    await withRetry('mark_realized', () => chain.markRealized(VAULT_ID, gross));
    ok(`mark_realized     → Realized (${fmt(gross.amount)} USDC gross, +30%)`);

    // settle reads the vault's real balance, so the proceeds must genuinely be
    // there. In production this is the broker's wire; here it is minted, exactly
    // as the acceptance harness does on localnet.
    await returnProceeds(conn, artifacts, adminKeypairPath, VAULT_ID, gross.amount);
    await withRetry('settle', () => chain.settleVault(VAULT_ID, gross));
    const claimable = await withRetry('getVault', () => chain.getVault(VAULT_ID));
    if (claimable!.phase !== 'Claimable') fail(`expected Claimable, got ${claimable!.phase}`);
    ok(`settle            → Claimable · redeemable ${fmt(claimable!.redeemableAmount?.amount ?? 0n)} USDC across ${fmt(claimable!.totalShares)} tokens`);

    step(5, 'A stale transition is refused, not silently absorbed');
    try {
      await chain.sealFunding(VAULT_ID);
      fail('seal_funding on a Claimable vault was accepted');
    } catch (error) {
      if (error instanceof ProofFailure) throw error;
      ok(`seal_funding on a Claimable vault → ${(error as Error).message}`);
    }
  }

  step(6, 'The ledger balances');
  ledger.assertBalanced();
  ok(`debits equal credits · ${JSON.stringify(ledger.trialBalance().cash)}`);

  console.log(`\n✓ The orchestrator read, watched, and drove the live devnet programs.\n`);
}

/** Mint sale proceeds into the vault's real USDC account (simulates the wire). */
async function returnProceeds(
  conn: Connection,
  artifacts: ReturnType<typeof loadArtifacts>,
  adminKeypairPath: string,
  vaultId: string,
  gross: bigint,
): Promise<void> {
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(adminKeypairPath, 'utf8')) as number[]));
  const vault = vaultPda(artifacts.vaultProgramId, admin.publicKey, vaultId);
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: 'confirmed' });
  const program = new Program(artifacts.vaultIdl, provider);
  const raw = await withRetry('read vaultUsdc', () =>
    (program.account as any).vault.fetch(vault) as Promise<{ vaultUsdc: PublicKey }>,
  );
  // Idempotent top-up: re-read the balance each attempt and mint only the
  // shortfall, so a retry after a lost confirmation cannot double the proceeds.
  await withRetry('return_proceeds', async () => {
    const acct = await getAccount(conn, raw.vaultUsdc);
    if (acct.amount >= gross) return;
    await mintTo(conn, admin, artifacts.usdcMint, raw.vaultUsdc, admin, gross - acct.amount);
  });
  const after = await withRetry('read vaultUsdc', () => getAccount(conn, raw.vaultUsdc));
  ok(`broker returned ${fmt(gross)} USDC · vault holds ${fmt(after.amount)}`);
}

main().catch((error) => {
  if (error instanceof ProofFailure) console.error(`   ✗ ${error.message}\n`);
  else console.error(`\n${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
