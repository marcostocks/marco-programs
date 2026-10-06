/**
 * Drive a funded vault all the way to Claimable, so holders can redeem.
 *
 *   VAULT_ID=byte-2026-s GAIN=30 npx tsx scripts/settle-vault-devnet.ts
 *
 * Funding → Sealed → Sourcing → Sourced → Deployed → Live → Realized → Claimable.
 * Every step is the real operator instruction through the production adapter,
 * which is why they are idempotent: re-running after a dropped confirmation
 * recognises what already landed instead of doing it twice.
 *
 * `settle` reads the vault's actual USDC balance, so the sale proceeds have to
 * genuinely be there. In production that is the broker's wire; on devnet it is
 * minted by the admin, which holds the test mint authority. That mint is the
 * one piece of this that is simulated, and it is the seam a real custodian
 * replaces.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAssociatedTokenAddress, mintTo } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

import { SolanaChain } from '../src/adapters/solana/chain.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { systemClock } from '../src/domain/clock.js';
import { money, quantity } from '../src/domain/money.js';
import { ConsoleLogger } from '../src/support/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS = join(HERE, '..', '..', '.localnet', 'keys');

const VAULT_ID = process.env.VAULT_ID ?? 'byte-2026-s';
/** Listing gain, in percent, applied to gross deposits. */
const GAIN = Number(process.env.GAIN ?? 30);

const keypair = (name: string): Keypair => {
  const env = process.env[`${name.toUpperCase()}_KEYPAIR`];
  const path = env ? env.replace(/^~/, process.env.HOME ?? '') : join(KEYS, `${name}.json`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (n: bigint) => (Number(n) / 1e6).toLocaleString();

async function main() {
  const artifacts = loadArtifacts();
  const admin = keypair('admin');
  const chain = new SolanaChain({
    clock: systemClock,
    logger: new ConsoleLogger('warn'),
    rpcUrl: artifacts.addresses.rpcUrl,
    operator: keypair('operator'),
    admin,
    artifacts,
  });

  const v0 = await chain.getVault(VAULT_ID);
  if (!v0) throw new Error(`no vault ${VAULT_ID} on ${artifacts.addresses.cluster}`);
  console.log(`${VAULT_ID}: ${v0.phase} · ${usd(v0.totalDeposits.amount)} deposited · ${usd(v0.totalShares)} tokens`);
  if (v0.totalDeposits.amount === 0n) throw new Error('nothing subscribed — fill it first');

  const deployable = money('USDC', v0.totalDeposits.amount);
  const gross = money('USDC', (v0.totalDeposits.amount * BigInt(100 + GAIN)) / 100n);

  const step = async (label: string, run: () => Promise<unknown>, expect: string) => {
    const r: any = await run();
    await sleep(600);
    const s = await chain.getVault(VAULT_ID);
    console.log(`  ${label.padEnd(18)}→ ${s?.phase}${r?.alreadyApplied ? '  (already applied)' : ''}`);
    if (s?.phase !== expect) throw new Error(`expected ${expect}, got ${s?.phase}`);
  };

  if (v0.phase === 'Funding') await step('seal_funding', () => chain.sealFunding(VAULT_ID), 'Sealed');
  if (['Funding', 'Sealed'].includes(v0.phase))
    await step('begin_sourcing', () => chain.beginSourcing(VAULT_ID), 'Sourcing');
  if (['Funding', 'Sealed', 'Sourcing'].includes(v0.phase))
    await step('confirm_allocation', () => chain.confirmAllocation(VAULT_ID, deployable), 'Sourced');
  if (['Funding', 'Sealed', 'Sourcing', 'Sourced'].includes(v0.phase))
    await step('deploy_capital', () => chain.deployCapital(VAULT_ID, deployable), 'Deployed');
  if (!['Live', 'Realized', 'Claimable', 'Winding'].includes(v0.phase))
    await step('mark_listed', () => chain.markListed(VAULT_ID, quantity(VAULT_ID, 100_000n), 0), 'Live');
  if (!['Realized', 'Claimable', 'Winding'].includes(v0.phase))
    await step('mark_realized', () => chain.markRealized(VAULT_ID, gross), 'Realized');

  // The proceeds have to be in the vault before settle, which reads the balance.
  const vaultPda = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('vault'), admin.publicKey.toBuffer(), new TextEncoder().encode(VAULT_ID)],
    new PublicKey(artifacts.addresses.programs.marcoVault),
  )[0];
  const conn = new Connection(artifacts.addresses.rpcUrl, 'confirmed');
  const usdcMint = new PublicKey(artifacts.addresses.usdc.mint);
  const vaultUsdc = await getAssociatedTokenAddress(usdcMint, vaultPda, true);
  console.log(`  returning ${usd(gross.amount)} USDC of proceeds (minted — the custodian seam)`);
  await mintTo(conn, admin, usdcMint, vaultUsdc, admin, gross.amount);
  await sleep(800);

  await step('settle', () => chain.settleVault(VAULT_ID, gross), 'Claimable');

  const done = await chain.getVault(VAULT_ID);
  const redeemable = done?.redeemableAmount?.amount ?? 0n;
  const perToken = Number(redeemable) / Number(done?.totalShares ?? 1n);
  console.log(
    `\n  ${VAULT_ID}: ${done?.phase} · redeemable ${usd(redeemable)} USDC across ` +
      `${usd(done?.totalShares ?? 0n)} tokens = ${perToken.toFixed(4)} per token` +
      `\n  a holder redeeming now receives that, less the ${(done?.feeBps ?? 0) / 100}% exit fee`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
