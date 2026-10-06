/**
 * Publish the devnet deployment artifacts the orchestrator reads.
 *
 * Unlike setup-localnet, this does NOT create wallets or a mint — it points at
 * what is already deployed on devnet:
 *   - the two programs (already live),
 *   - the shared test USDC mint created by the spot-market setup,
 *   - the single deploy wallet, which is admin = operator = treasury (that is
 *     how the existing market and vault were created, so PDAs and signatures
 *     must derive from it).
 *
 * It ensures the treasury/broker/demo USDC token accounts exist and writes
 * shared/marco-artifacts/addresses.json for cluster=devnet, plus copies the
 * current IDLs so their program ids match on load.
 *
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   DEPLOY_KEYPAIR=~/.config/solana/id.json \
 *   npx tsx scripts/setup-devnet.ts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getMint, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ARTIFACTS = join(ROOT, 'shared', 'marco-artifacts');
const GENERATED_TYPES = join(HERE, '..', 'src', 'adapters', 'solana', 'generated');

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const MARCO_SPOT = '44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e';
const MARCO_VAULT = 'CgJnDJHjhkMgrkaky3Dp9dD89NzXRMP287bqmgCPMC8q';
// The devnet test USDC created alongside the 0700.HK market. Reused, never
// recreated: the live market and vault are bound to this exact mint.
const USDC_MINT = 'C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef';

function loadKeypair(path: string): Keypair {
  const resolved = path.replace(/^~/, homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolved, 'utf8'))));
}

async function main(): Promise<void> {
  const conn = new Connection(RPC_URL, 'confirmed');
  const deploy = loadKeypair(process.env.DEPLOY_KEYPAIR ?? '~/.config/solana/id.json');
  console.log(`setup-devnet · ${RPC_URL}`);
  console.log(`deploy wallet (admin=operator=treasury): ${deploy.publicKey.toBase58()}`);

  for (const id of [MARCO_SPOT, MARCO_VAULT]) {
    const info = await conn.getAccountInfo(new PublicKey(id));
    if (!info?.executable) throw new Error(`program ${id} is not deployed on ${RPC_URL}`);
  }
  const usdcMint = new PublicKey(USDC_MINT);
  const mint = await getMint(conn, usdcMint);
  console.log(`usdc mint ${USDC_MINT} · decimals ${mint.decimals}`);

  // The deploy wallet's USDC ATA covers treasury/broker/demo in this
  // single-operator devnet posture. sweep_fee needs treasuryUsdc to exist.
  const usdcAta = (await getOrCreateAssociatedTokenAccount(conn, deploy, usdcMint, deploy.publicKey)).address;
  console.log(`deploy USDC ata ${usdcAta.toBase58()}`);

  // Refresh IDLs from the built programs so their embedded program id matches
  // addresses.json (loadArtifacts refuses a mismatch).
  mkdirSync(join(ARTIFACTS, 'idl'), { recursive: true });
  mkdirSync(GENERATED_TYPES, { recursive: true });
  for (const [name, pkg] of [['marco_spot', 'spotstocks'], ['marco_vault', 'preipovaults']] as const) {
    const idl = join(ROOT, pkg, 'target', 'idl', `${name}.json`);
    const types = join(ROOT, pkg, 'target', 'types', `${name}.ts`);
    if (!existsSync(idl)) throw new Error(`missing ${idl} — run 'anchor build' in ${pkg}`);
    copyFileSync(idl, join(ARTIFACTS, 'idl', `${name}.json`));
    if (existsSync(types)) copyFileSync(types, join(GENERATED_TYPES, `${name}.ts`));
  }

  const addresses = {
    cluster: 'devnet',
    rpcUrl: RPC_URL,
    generatedBy: 'orchestrator/scripts/setup-devnet.ts',
    programs: { marcoSpot: MARCO_SPOT, marcoVault: MARCO_VAULT },
    usdc: { mint: USDC_MINT, decimals: mint.decimals },
    wallets: {
      admin: deploy.publicKey.toBase58(),
      operator: deploy.publicKey.toBase58(),
      treasury: deploy.publicKey.toBase58(),
      broker: deploy.publicKey.toBase58(),
      demoTrader: deploy.publicKey.toBase58(),
    },
    tokenAccounts: {
      brokerUsdc: usdcAta.toBase58(),
      treasuryUsdc: usdcAta.toBase58(),
      demoTraderUsdc: usdcAta.toBase58(),
    },
  };
  writeFileSync(join(ARTIFACTS, 'addresses.json'), `${JSON.stringify(addresses, null, 2)}\n`);
  console.log('\nwrote shared/marco-artifacts/addresses.json (cluster=devnet)');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
