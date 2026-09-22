/**
 * Live deposit demo on devnet.
 *
 * Admin opens the funding window (Scheduled -> Funding), mints a fresh
 * depositor (bob) test USDC, and bob subscribes 1,000 USDC. The vault takes a
 * 5% entry fee off the top and mints bob 950 claim tokens 1:1 against the net,
 * then freezes them in his wallet (Phase-1 transfer lock). Proves the
 * depositor-facing path end to end.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/demo-deposit-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

const V = require("./devnet-vault.json");
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));

function loadWallet(): Keypair {
  const path = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`)
    .replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

async function main() {
  const admin = loadWallet();
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed"
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<MarcoVault>(idl as MarcoVault, provider);

  const vault = new PublicKey(V.vault);
  const shareMint = new PublicKey(V.shareMint);
  const vaultUsdc = new PublicKey(V.vaultUsdc);
  const usdcMint = new PublicKey(V.usdcMint);

  // --- open the funding window if still Scheduled ---
  const v0 = await program.account.vault.fetch(vault);
  if (Object.keys(v0.phase)[0] === "scheduled") {
    await program.methods.openFunding().accountsPartial({ vault, admin: admin.publicKey }).rpc();
    console.log("open_funding: Scheduled -> Funding ✓");
  } else {
    console.log("vault phase:", Object.keys(v0.phase)[0]);
  }

  // --- fresh depositor ---
  const bob = Keypair.generate();
  console.log("depositor (bob):", bob.publicKey.toBase58());
  await provider.sendAndConfirm(
    new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: bob.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL,
    }))
  );

  // give bob 2,000 test USDC; create his claim-token account (must exist — deposit doesn't init it)
  const bobUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, bob.publicKey);
  await mintTo(connection, admin, usdcMint, bobUsdc.address, admin, 2_000 * 1e6);
  const bobShares = await getOrCreateAssociatedTokenAccount(connection, admin, shareMint, bob.publicKey);
  const beforeDep = Number((await getAccount(connection, bobUsdc.address)).amount) / 1e6;
  console.log(`bob USDC before deposit: ${beforeDep}`);

  const [buyerState] = PublicKey.findProgramAddressSync(
    [Buffer.from("buyer"), vault.toBuffer(), bob.publicKey.toBuffer()], program.programId
  );

  // --- deposit 1,000 USDC ---
  const sig = await program.methods.deposit(USDC(1_000)).accountsPartial({
    vault, buyerState, shareMint,
    depositorUsdc: bobUsdc.address, vaultUsdc, depositorShares: bobShares.address,
    depositor: bob.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([bob]).rpc();
  console.log("\ndeposit tx:", sig);

  // --- proof: USDC pulled, claim tokens minted (net of fee) and frozen ---
  const v1 = await program.account.vault.fetch(vault);
  const bs = await program.account.buyerState.fetch(buyerState);
  const bobUsdcAfter = Number((await getAccount(connection, bobUsdc.address)).amount) / 1e6;
  const bobClaim = await getAccount(connection, bobShares.address);
  const vaultBal = Number((await getAccount(connection, vaultUsdc)).amount) / 1e6;

  console.log("\n=== Deposit result ===");
  console.log(`bob USDC       : ${beforeDep} -> ${bobUsdcAfter}  (-${beforeDep - bobUsdcAfter})`);
  console.log(`bob claim toks : ${Number(bobClaim.amount) / 1e6}  (frozen: ${bobClaim.isFrozen})`);
  console.log(`vault USDC     : ${vaultBal}`);
  console.log("\n=== Vault accounting ===");
  console.log(`phase          : ${Object.keys(v1.phase)[0]}`);
  console.log(`total_deposits : ${v1.totalDeposits.toNumber() / 1e6} USDC (gross)`);
  console.log(`total_shares   : ${v1.totalShares.toNumber() / 1e6} (net, = claim tokens minted)`);
  console.log(`fees_escrowed  : ${v1.feesEscrowed.toNumber() / 1e6} USDC (earned only when capital deploys)`);
  console.log(`buyer_state.deposit_amount: ${bs.depositAmount.toNumber() / 1e6} | shares_minted: ${bs.sharesMinted.toNumber() / 1e6}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
