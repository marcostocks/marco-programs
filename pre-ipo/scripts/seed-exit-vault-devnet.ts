/**
 * Seed a subscribable EXIT-FEE vault on devnet for the browser to point at.
 *
 * Creates the vault with its USDC as the vault PDA's ATA (what the browser
 * client derives), flips it to fee-at-exit before any deposit, and opens
 * funding — so a wallet can subscribe and receive tokens 1:1 with their gross
 * deposit ($1,000 → 1,000 tokens), the 5% coming off the redemption later.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/seed-exit-vault-devnet.ts [vaultId]
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

const TEST_USDC = new PublicKey("C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef");
const VAULT_ID = process.argv[2] ?? "deepseek-2026";
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
const DAY = 86400;

function loadWallet() {
  const p = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`).replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main() {
  const admin = loadWallet();
  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<MarcoVault>(idl as MarcoVault, provider);

  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)], program.programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), vault.toBuffer()], program.programId);

  if (await connection.getAccountInfo(vault)) {
    const v = await program.account.vault.fetch(vault);
    console.log(`vault ${VAULT_ID} already exists · phase ${Object.keys(v.phase)[0]} · fee_at_exit ${v.feeAtExit}`);
    return;
  }

  // vault USDC as the vault PDA's ATA — the address the browser client derives.
  const vaultUsdc = (await getOrCreateAssociatedTokenAccount(connection, admin, TEST_USDC, vault, true)).address;
  // Immutable broker destination: the deploy wallet's own USDC ATA is fine on devnet.
  const brokerUsdc = (await getOrCreateAssociatedTokenAccount(connection, admin, TEST_USDC, admin.publicKey)).address;

  const now = Math.floor(Date.now() / 1000);
  await program.methods.initializeVault({
    vaultId: VAULT_ID, depositCap: USDC(4_000_000), minDeposit: USDC(100), maxDeposit: USDC(0),
    fundingStart: new anchor.BN(now), fundingDeadline: new anchor.BN(now + 90 * DAY), closeOutAt: new anchor.BN(now + 365 * DAY), feeBps: 500,
  }).accountsPartial({
    vault, shareMint, vaultUsdc, depositDestination: brokerUsdc, admin: admin.publicKey, operator: admin.publicKey, treasury: admin.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }).rpc();

  await program.methods.setFeeTiming(true).accountsPartial({ vault, admin: admin.publicKey }).rpc();
  await program.methods.openFunding().accountsPartial({ vault, admin: admin.publicKey }).rpc();

  const v = await program.account.vault.fetch(vault);
  console.log(`seeded exit-fee vault ${VAULT_ID}`);
  console.log(`  vault      ${vault.toBase58()}`);
  console.log(`  claim mint ${shareMint.toBase58()}`);
  console.log(`  phase ${Object.keys(v.phase)[0]} · fee_at_exit ${v.feeAtExit} · fee ${v.feeBps}bps · cap ${Number(v.depositCap) / 1e6}`);
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
