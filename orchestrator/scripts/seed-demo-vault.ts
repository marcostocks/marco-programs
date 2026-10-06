/**
 * Create the vault the site's Moonshot AI card points at, and open funding.
 *
 * Separate from `setup-localnet.ts` because that script prepares the *cluster*
 * — mint, wallets, artifacts — while this one creates a *deal*. Re-running is
 * safe: both calls are idempotent by on-chain state.
 *
 *   npm run seed:vault
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Keypair } from '@solana/web3.js';

import { SolanaChain } from '../src/adapters/solana/chain.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { systemClock } from '../src/domain/clock.js';
import { money } from '../src/domain/money.js';
import { ConsoleLogger } from '../src/support/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS = join(HERE, '..', '..', '.localnet', 'keys');

/**
 * Must match `chainId` on the Moonshot entries in src/parts/p3-data.js and
 * moonshot/src/parts/p3-data.js.
 *
 * `moon-2026` was created before the fee moved to redemption and is stuck on
 * the old model: `set_fee_timing` is refused once a vault holds deposits, and
 * that one does. Hence a new id rather than a re-seed — override with
 * VAULT_ID=… to seed another.
 */
const VAULT_ID = process.env.VAULT_ID ?? 'moon-2026-x';

/** Deposit cap in whole USDC. Fixed at creation — the program has no
 *  instruction to change it, so a different cap means a different vault. */
const CAP = Number(process.env.CAP ?? 4_000_000);

/** How long the subscription window stays open, in days. This is the deadline
 *  the program enforces, and the one the page counts down to. */
const DAYS = Number(process.env.DAYS ?? 30);

if (!(CAP > 0)) throw new Error(`CAP must be a positive number of USDC, got "${process.env.CAP}"`);
if (!(DAYS > 0)) throw new Error(`DAYS must be positive, got "${process.env.DAYS}"`);

/**
 * Keypair resolution: OPERATOR_KEYPAIR / ADMIN_KEYPAIR env paths first (the
 * devnet posture, where both are the deploy wallet), else .localnet/keys.
 * The admin here MUST be the artifacts' admin — the vault PDA derives from it.
 */
const keypair = (name: string): Keypair => {
  const env = process.env[`${name.toUpperCase()}_KEYPAIR`];
  const path = env
    ? env.replace(/^~/, process.env.HOME ?? '')
    : join(KEYS, `${name}.json`);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]),
  );
};

const usdc = (n: number) => money('USDC', BigInt(Math.round(n * 1e6)));

async function main(): Promise<void> {
  const artifacts = loadArtifacts();
  const chain = new SolanaChain({
    clock: systemClock,
    logger: new ConsoleLogger('info'),
    rpcUrl: artifacts.addresses.rpcUrl,
    operator: keypair('operator'),
    admin: keypair('admin'),
    artifacts,
  });

  const now = Date.now();
  const created = await chain.initializeVault({
    vaultId: VAULT_ID,
    depositCap: usdc(CAP),
    minDeposit: usdc(100),
    maxDeposit: usdc(0),
    // The program checks against the validator's clock, which lags wall-clock
    // on a local node, so the window opens comfortably in the past.
    fundingStart: new Date(now - 3_600_000).toISOString(),
    fundingDeadline: new Date(now + DAYS * 86_400_000).toISOString(),
    closeOutAt: new Date(now + 365 * 86_400_000).toISOString(),
    feeBps: 500,
    depositDestination: artifacts.addresses.tokenAccounts.brokerUsdc,
    treasury: artifacts.addresses.wallets.treasury,
  });

  // Before funding opens, and therefore before anyone can deposit — which is
  // the only window the program allows. A subscription mints claim tokens 1:1
  // against the gross, and the fee comes out of the redemption instead.
  const timing = await chain.setFeeTiming(VAULT_ID, true);

  const opened = await chain.openFunding(VAULT_ID);
  const state = await chain.getVault(VAULT_ID);

  console.log(`vault ${VAULT_ID}`);
  console.log(`  created   ${created.alreadyApplied ? 'already existed' : created.signature}`);
  console.log(`  fee       ${timing.alreadyApplied ? 'already at redemption' : timing.signature}`);
  console.log(`  funding   ${opened.alreadyApplied ? 'already open' : opened.signature}`);
  console.log(`  phase     ${state?.phase}`);
  console.log(`  cap       ${Number(state?.cap.amount ?? 0n) / 1e6} USDC`);
  console.log(`  raised    ${Number(state?.totalDeposits.amount ?? 0n) / 1e6} USDC`);
  console.log(`  closes    in ${DAYS} days`);
  console.log(`  feeBps    ${state?.feeBps} · charged at ${state?.feeAtExit ? 'redemption' : 'deposit'}`);
  console.log(`  address   ${state?.vaultAddress}`);

  if (!state?.feeAtExit) {
    throw new Error(
      `${VAULT_ID} is charging the fee at deposit. set_fee_timing only works before the ` +
        `first deposit — if this vault already has any, seed a new id instead.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
