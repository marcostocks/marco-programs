/**
 * Fund a wallet so it can subscribe to the vaults on the shared site.
 *
 *   npx tsx scripts/fund-recipient.ts <wallet-address> [usdcAmount] [solAmount]
 *
 * Mints the vault's test USDC (the admin is the mint authority) straight to the
 * recipient's associated token account, and tops their SOL up to a small floor
 * so they can pay fees + the rent for their claim-token account. Devnet only,
 * test money only.
 */
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';

const ROOT = '/Users/tonytran/Documents/Claude/Projects/Marco';
const addresses = JSON.parse(readFileSync(`${ROOT}/shared/marco-artifacts/addresses.json`, 'utf8'));
const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')) as number[]),
);

const RECIPIENT = process.argv[2];
const USDC_AMOUNT = Number(process.argv[3] ?? 5000);   // display USDC
const SOL_FLOOR = Number(process.argv[4] ?? 0.05);     // top the wallet up to at least this much SOL

if (!RECIPIENT) {
  console.error('usage: npx tsx scripts/fund-recipient.ts <wallet-address> [usdcAmount] [solAmount]');
  process.exit(1);
}

const USDC = new PublicKey(addresses.usdc.mint);
const DECIMALS = addresses.usdc.decimals ?? 6;
const conn = new Connection(addresses.rpcUrl, 'confirmed');

async function main() {
  let recipient: PublicKey;
  try { recipient = new PublicKey(RECIPIENT); }
  catch { console.error(`not a valid wallet address: ${RECIPIENT}`); process.exit(1); }

  console.log(`admin/mint-authority ${admin.publicKey.toBase58()}`);
  console.log(`recipient            ${recipient.toBase58()}`);
  console.log(`test USDC mint       ${USDC.toBase58()}\n`);

  // 1. Mint test USDC into the recipient's ATA (created if missing; admin pays rent).
  const ata = await getOrCreateAssociatedTokenAccount(conn, admin, USDC, recipient);
  const base = BigInt(Math.round(USDC_AMOUNT * 10 ** DECIMALS));
  await mintTo(conn, admin, USDC, ata.address, admin, base);
  const bal = Number((await getAccount(conn, ata.address)).amount) / 10 ** DECIMALS;
  console.log(`✓ minted ${USDC_AMOUNT.toLocaleString()} test USDC — balance now ${bal.toLocaleString()}`);

  // 2. Top up SOL to the floor so they can pay fees + claim-token account rent.
  const have = (await conn.getBalance(recipient)) / LAMPORTS_PER_SOL;
  if (have < SOL_FLOOR) {
    const lamports = Math.round((SOL_FLOOR - have) * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: recipient, lamports,
    }));
    await sendAndConfirmTransaction(conn, tx, [admin]);
    console.log(`✓ sent ${(lamports / LAMPORTS_PER_SOL).toFixed(3)} SOL — balance now ${SOL_FLOOR.toFixed(3)}`);
  } else {
    console.log(`✓ SOL already sufficient (${have.toFixed(3)})`);
  }

  console.log('\nRecipient is ready: Phantom on Devnet → connect on the site → Subscribe.');
}
main().catch((e) => { console.error(e); process.exit(1); });
