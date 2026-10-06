/**
 * Prepare a running local validator and publish the addresses everything else
 * reads.
 *
 * The single source of truth this writes — `shared/marco-artifacts/` — exists
 * because the alternative was tried and failed: `preipovaults/app` hard-coded a
 * program id by hand and got Anchor's placeholder `Fg6PaFpo…` instead of the
 * real one, which no amount of frontend debugging would have explained.
 * Nothing downstream should ever type an address in again.
 *
 * Re-running is safe, and every address it publishes is stable across a
 * `--reset`: the wallets and the mint are persisted keypairs under
 * `.localnet/keys/`, and the token accounts are ATAs derived from them. That
 * matters because those addresses are compiled into the frontend bundle and
 * fixed into vaults at creation — a mint that moved on every reset would break
 * the browser's deposit path with nothing to indicate why.
 *
 *   npm run setup:localnet
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const KEYS = join(ROOT, '.localnet', 'keys');
const ARTIFACTS = join(ROOT, 'shared', 'marco-artifacts');
const GENERATED_TYPES = join(HERE, '..', 'src', 'adapters', 'solana', 'generated');

const RPC_URL = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8899';

const MARCO_SPOT = '44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e';
const MARCO_VAULT = 'CgJnDJHjhkMgrkaky3Dp9dD89NzXRMP287bqmgCPMC8q';

/** USDC's real decimals. Getting this wrong silently mis-scales every amount. */
const USDC_DECIMALS = 6;
const USDC = (n: number) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

/** Load a keypair from disk, generating and persisting it on first run. */
function persistentKeypair(name: string): Keypair {
  mkdirSync(KEYS, { recursive: true });
  const path = join(KEYS, `${name}.json`);
  if (existsSync(path)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function fund(conn: Connection, to: PublicKey, sol: number): Promise<void> {
  const balance = await conn.getBalance(to);
  if (balance >= sol * LAMPORTS_PER_SOL) return;
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
}

async function main(): Promise<void> {
  const conn = new Connection(RPC_URL, 'confirmed');

  try {
    await conn.getVersion();
  } catch {
    throw new Error(`no validator at ${RPC_URL} — run 'sh scripts/localnet.sh' first`);
  }

  for (const id of [MARCO_SPOT, MARCO_VAULT]) {
    const info = await conn.getAccountInfo(new PublicKey(id));
    if (!info?.executable) throw new Error(`program ${id} is not loaded on ${RPC_URL}`);
  }

  // admin creates deals; operator is the orchestrator's signer; treasury
  // receives swept fees; broker is the immutable off-chain destination.
  const admin = persistentKeypair('admin');
  const operator = persistentKeypair('operator');
  const treasury = persistentKeypair('treasury');
  const broker = persistentKeypair('broker');
  const demoTrader = persistentKeypair('demo-trader');

  for (const kp of [admin, operator, treasury, broker, demoTrader]) {
    await fund(conn, kp.publicKey, 100);
  }

  // Admin holds mint authority so the demo can top traders up on demand. No
  // freeze authority: a freeze on the *stablecoin* is not part of the model,
  // and handing it out would let the demo mint contradict the real one.
  //
  // The mint keypair persists like the wallets do, so a `--reset` produces the
  // same mint address. Otherwise every reset invalidates the address baked
  // into the frontend bundle and silently breaks the browser's deposit path.
  const mintKeypair = persistentKeypair('usdc-mint');
  const usdcMint = (await conn.getAccountInfo(mintKeypair.publicKey))
    ? mintKeypair.publicKey
    : await createMint(conn, admin, admin.publicKey, null, USDC_DECIMALS, mintKeypair);

  // ATAs rather than freshly-keyed accounts, so these addresses are derivable
  // and survive a reset alongside the mint. A random keypair here would move
  // the broker's immutable destination on every reset — and that address is
  // fixed into every vault at creation.
  const ata = async (owner: PublicKey): Promise<PublicKey> =>
    (await getOrCreateAssociatedTokenAccount(conn, admin, usdcMint, owner)).address;

  const brokerUsdc = await ata(broker.publicKey);
  const treasuryUsdc = await ata(treasury.publicKey);
  const demoTraderUsdc = await ata(demoTrader.publicKey);

  await mintTo(conn, admin, usdcMint, demoTraderUsdc, admin, USDC(1_000_000));

  mkdirSync(join(ARTIFACTS, 'idl'), { recursive: true });
  mkdirSync(GENERATED_TYPES, { recursive: true });

  const programs: Record<string, string> = {
    marco_spot: join(ROOT, 'spotstocks', 'target'),
    marco_vault: join(ROOT, 'preipovaults', 'target'),
  };
  for (const [name, target] of Object.entries(programs)) {
    const idl = join(target, 'idl', `${name}.json`);
    if (!existsSync(idl)) throw new Error(`missing ${idl} — run 'anchor build' there`);
    copyFileSync(idl, join(ARTIFACTS, 'idl', `${name}.json`));

    // The generated .ts types land inside the orchestrator's source tree
    // rather than in shared/, because TypeScript will only compile what is
    // under its rootDir — and they are what turns an account-name typo into a
    // compile error instead of a runtime "AccountNotFound" that names nothing.
    // The frontend reads the .json IDL and needs no types.
    const types = join(target, 'types', `${name}.ts`);
    if (!existsSync(types)) throw new Error(`missing ${types} — run 'anchor build' there`);
    copyFileSync(types, join(GENERATED_TYPES, `${name}.ts`));
  }

  const addresses = {
    cluster: 'localnet',
    rpcUrl: RPC_URL,
    generatedBy: 'orchestrator/scripts/setup-localnet.ts',
    programs: { marcoSpot: MARCO_SPOT, marcoVault: MARCO_VAULT },
    usdc: { mint: usdcMint.toBase58(), decimals: USDC_DECIMALS },
    wallets: {
      admin: admin.publicKey.toBase58(),
      operator: operator.publicKey.toBase58(),
      treasury: treasury.publicKey.toBase58(),
      broker: broker.publicKey.toBase58(),
      demoTrader: demoTrader.publicKey.toBase58(),
    },
    tokenAccounts: {
      brokerUsdc: brokerUsdc.toBase58(),
      treasuryUsdc: treasuryUsdc.toBase58(),
      demoTraderUsdc: demoTraderUsdc.toBase58(),
    },
  };

  writeFileSync(join(ARTIFACTS, 'addresses.json'), `${JSON.stringify(addresses, null, 2)}\n`);

  console.log(`artifacts written to shared/marco-artifacts/`);
  console.log(`  usdc mint      ${addresses.usdc.mint}`);
  console.log(`  admin          ${addresses.wallets.admin}`);
  console.log(`  operator       ${addresses.wallets.operator}`);
  console.log(`  broker usdc    ${addresses.tokenAccounts.brokerUsdc}  (immutable destination)`);
  console.log(`  demo trader    ${addresses.wallets.demoTrader}  funded 1,000,000 USDC`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
