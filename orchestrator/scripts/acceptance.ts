/**
 * End-to-end acceptance against a live validator.
 *
 * The unit suite proves the orchestration logic against `MockChain`, and the
 * integration test proves the adapter can talk to the programs. Neither proves
 * the seam that matters most: that a deposit made *by a wallet, in a browser*
 * is seen by the real `ChainWatcher`, becomes an intent, and that the vault can
 * then be driven to the point where that same wallet can claim.
 *
 * This runs that path with the production code — real `bootstrap`, real
 * watcher, real `SolanaChain` — and only mocks the counterparties that would
 * otherwise be a bank.
 *
 *   npm run acceptance
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Keypair } from '@solana/web3.js';

import { bootstrap } from '../src/bootstrap.js';
import { testConfig } from '../src/config/config.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { money } from '../src/domain/money.js';
import { quantity } from '../src/domain/money.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS = join(HERE, '..', '..', '.localnet', 'keys');

const VAULT_ID = process.argv[2] ?? 'moon-2026';
const usdc = (n: number) => money('USDC', BigInt(Math.round(n * 1e6)));
const fmt = (n: bigint) => (Number(n) / 1e6).toLocaleString('en-US');

const step = (n: number, text: string) => console.log(`\n${n}. ${text}`);
const ok = (text: string) => console.log(`   ✓ ${text}`);

class AcceptanceFailure extends Error {}
function fail(text: string): never {
  throw new AcceptanceFailure(text);
}

async function main(): Promise<void> {
  const artifacts = loadArtifacts();

  // The real composition root, with only the chain port pointed at the
  // validator. Treasury and webhook settings come from the test defaults —
  // they govern the mock counterparties, which is what they are here.
  const runtime = bootstrap({
    config: testConfig({
      providers: {
        msb: 'mock',
        broker: 'mock',
        custodian: 'mock',
        compliance: 'mock',
        chain: 'solana',
      },
      solana: {
        rpcUrl: artifacts.addresses.rpcUrl,
        spotProgramId: artifacts.addresses.programs.marcoSpot,
        vaultProgramId: artifacts.addresses.programs.marcoVault,
        signerKind: 'file',
        operatorKeypairPath: join(KEYS, 'operator.json'),
        adminKeypairPath: join(KEYS, 'admin.json'),
      },
    }),
  });

  const { chain, ledger, store } = runtime.services;
  console.log(`acceptance · vault ${VAULT_ID} · ${artifacts.addresses.rpcUrl}`);

  step(1, 'Vault exists and is funded');
  const initial = await chain.getVault(VAULT_ID);
  if (!initial) throw new AcceptanceFailure(`no vault ${VAULT_ID} — run 'npm run seed:vault'`);
  if (initial.totalDeposits.amount === 0n) {
    fail('vault has no deposits — subscribe from the browser first');
  }
  ok(`phase ${initial.phase}, ${fmt(initial.totalDeposits.amount)} USDC gross deposited`);
  ok(`${fmt(initial.totalShares)} claim tokens outstanding (net of the ${initial.feeBps / 100}% fee)`);

  step(2, 'The watcher sees the holder deposit and creates an intent');
  // This run starts with an empty store, so the cursor begins at slot 0 and
  // sees only what the RPC still retains. A long-lived orchestrator persists
  // its cursor and polls forward, so it never looks back further than the last
  // poll — but that is also the operational limit: if it is down longer than
  // the RPC's signature retention, deposits are missed silently. Hence the
  // deliberately weak assertion here, and the reconciliation check below.
  const result = await runtime.watcher.poll(200);
  const intents = await store.intents.list({});
  const subscribes = intents.filter(
    (i) => i.kind === 'VAULT_SUBSCRIBE' && i.request.vaultId === VAULT_ID,
  );
  if (subscribes.length === 0) fail('no VAULT_SUBSCRIBE intent was created from the chain event');
  ok(`polled ${result.polled} events, created ${result.created} intents`);
  for (const intent of subscribes) {
    ok(`${intent.id} · wallet ${intent.wallet.slice(0, 8)}… · ${fmt(intent.request.amount!.amount)} USDC`);
  }

  const observed = subscribes.reduce((sum, i) => sum + (i.request.amount?.amount ?? 0n), 0n);
  if (observed < initial.totalDeposits.amount) {
    // Not a failure: it is what a break looks like, and naming it is the point.
    ok(
      `observed ${fmt(observed)} of ${fmt(initial.totalDeposits.amount)} on-chain — ` +
        `the remainder predates the RPC's retained window and would surface as a recon break`,
    );
  }

  step(3, 'Re-polling the same window creates nothing (dedupe by signature)');
  const replay = await runtime.watcher.poll(200);
  if (replay.created !== 0) fail(`replay created ${replay.created} duplicate intents`);
  ok(`${replay.polled} events re-observed, 0 duplicates`);

  step(4, 'Drive the vault to Claimable');
  const deposits = initial.totalDeposits.amount;
  // Deployable is the net subscribed capital; the upfront fee stays behind.
  const deployable = money('USDC', initial.totalShares);

  // Each transition is immediately replayed. Idempotency has to hold *while a
  // phase is current* — that is when a lost confirmation would actually cause
  // a resubmission. Replaying later is a different question, and the adapter
  // rightly answers it with a ConflictError rather than a false no-op.
  const advance = async (
    name: string,
    call: () => Promise<{ alreadyApplied: boolean }>,
    expected: string,
  ): Promise<void> => {
    const first = await call();
    if (first.alreadyApplied) fail(`${name} was already applied before this run`);

    const replay = await call();
    if (!replay.alreadyApplied) fail(`${name} re-submitted instead of recognising it had landed`);

    const state = await chain.getVault(VAULT_ID);
    if (state!.phase !== expected) fail(`${name} left the vault ${state!.phase}, expected ${expected}`);
    ok(`${name.padEnd(18)}→ ${expected}  (replay: alreadyApplied)`);
  };

  await advance('seal_funding', () => chain.sealFunding(VAULT_ID), 'Sealed');
  await advance('begin_sourcing', () => chain.beginSourcing(VAULT_ID), 'Sourcing');
  await advance(
    'confirm_allocation',
    () => chain.confirmAllocation(VAULT_ID, deployable),
    'Sourced',
  );

  await chain.deployCapital(VAULT_ID, deployable);
  const deployed = await chain.getVault(VAULT_ID);
  if (deployed!.phase !== 'Deployed') fail(`expected Deployed, got ${deployed!.phase}`);
  // The one transfer that leaves for the outside world, and it can only ever
  // go to the account fixed at creation.
  ok(`deploy_capital  → Deployed (to ${deployed!.brokerDestination.slice(0, 8)}…, immutable)`);

  // A zero-length election window so the run does not have to wait one out.
  await chain.markListed(VAULT_ID, quantity(VAULT_ID, 100_000n), 0);
  ok('mark_listed     → Live');

  const gross = money('USDC', (deposits * 130n) / 100n);
  await chain.markRealized(VAULT_ID, gross);
  ok(`mark_realized   → Realized (${fmt(gross.amount)} USDC gross, +30%)`);

  step(5, 'Return the cash and open redemption');
  // The vault must actually hold the proceeds before settle can make them
  // redeemable — settle records net cash, it does not conjure it.
  await returnProceeds(artifacts, VAULT_ID, gross.amount);
  await chain.settleVault(VAULT_ID, gross);

  const claimable = await chain.getVault(VAULT_ID);
  if (claimable!.phase !== 'Claimable') fail(`expected Claimable, got ${claimable!.phase}`);
  ok(`settle          → Claimable`);
  ok(`redeemable ${fmt(claimable!.redeemableAmount?.amount ?? 0n)} USDC against ${fmt(claimable!.totalShares)} tokens`);

  step(6, 'A stale transition is refused, not silently absorbed');
  // The counterpart to idempotency. Re-sealing a settled vault is not a
  // duplicate submission, it is an ordering bug, and answering it with a
  // cheerful no-op would hide exactly the case worth surfacing.
  try {
    await chain.sealFunding(VAULT_ID);
    fail('seal_funding on a Claimable vault was accepted');
  } catch (error) {
    if (error instanceof AcceptanceFailure) throw error;
    ok(`seal_funding on a Claimable vault → ${(error as Error).message}`);
  }

  step(7, 'The ledger balances');
  // Throws with the offending currency if any account total is non-zero.
  ledger.assertBalanced();
  ok(`debits equal credits · ${JSON.stringify(ledger.trialBalance().cash)}`);

  console.log(`\nVault ${VAULT_ID} is Claimable. Redeem from the browser to finish the loop.\n`);
}

/**
 * Simulate the broker wiring sale proceeds back.
 *
 * `settle` reads the vault's actual token balance rather than trusting the
 * amount it is told, so the cash has to genuinely be there. In the real system
 * it arrives by wire; here it is minted to the vault's USDC account.
 *
 * The full gross comes back, not just the profit — `deploy_capital` sent the
 * deployable capital out, and the broker returns the whole sale proceeds.
 */
async function returnProceeds(
  artifacts: ReturnType<typeof loadArtifacts>,
  vaultId: string,
  gross: bigint,
): Promise<void> {
  const { Connection } = await import('@solana/web3.js');
  const { getAccount, getAssociatedTokenAddress, mintTo } = await import('@solana/spl-token');
  const { vaultPda } = await import('../src/adapters/solana/pdas.js');

  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(KEYS, 'admin.json'), 'utf8')) as number[]),
  );
  const conn = new Connection(artifacts.addresses.rpcUrl, 'confirmed');
  const vault = vaultPda(artifacts.vaultProgramId, admin.publicKey, vaultId);
  const vaultUsdc = await getAssociatedTokenAddress(artifacts.usdcMint, vault, true);

  await mintTo(conn, admin, artifacts.usdcMint, vaultUsdc, admin, gross);
  const after = await getAccount(conn, vaultUsdc);
  ok(`broker returned ${fmt(gross)} USDC · vault holds ${fmt(after.amount)}`);
}

main().catch((error) => {
  if (error instanceof AcceptanceFailure) console.error(`   ✗ ${error.message}\n`);
  else console.error(`\n${error instanceof Error ? error.stack : error}`);
  process.exit(1);
});
