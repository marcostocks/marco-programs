/**
 * Live place_buy demo on devnet.
 *
 * Admin registers a fresh trader (alice) as eligible, mints her test USDC,
 * and alice places a real buy — her USDC moves into the market escrow and a
 * Pending order PDA opens. Proves the trader-facing entry path end to end.
 * (deploy_buy / confirm_buy are operator+off-chain steps, out of scope here.)
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/demo-buy-devnet.ts
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
import idl from "../target/idl/marco_spot.json";
import type { MarcoSpot } from "../target/types/marco_spot";

const M = require("./devnet-market.json");
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
  const program = new Program<MarcoSpot>(idl as MarcoSpot, provider);

  const market = new PublicKey(M.market);
  const marketUsdc = new PublicKey(M.marketUsdc);
  const usdcMint = new PublicKey(M.usdcMint);

  // --- fresh trader ---
  const alice = Keypair.generate();
  console.log("trader (alice):", alice.publicKey.toBase58());

  // fund alice with a little SOL for the rent she pays (order + holding PDAs)
  await provider.sendAndConfirm(
    new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: alice.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL,
    }))
  );

  // admin vouches for alice (records eligibility after off-chain KYC)
  const [traderAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("trader"), admin.publicKey.toBuffer(), alice.publicKey.toBuffer()], program.programId
  );
  await program.methods.registerTrader(true, 344 /* HK */).accountsPartial({
    traderAccount, admin: admin.publicKey, trader: alice.publicKey, systemProgram: SystemProgram.programId,
  }).rpc();
  console.log("registered alice as eligible ✓");

  // give alice 5,000 test USDC
  const aliceUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, alice.publicKey);
  await mintTo(connection, admin, usdcMint, aliceUsdc.address, admin, 5_000 * 1e6);
  const beforeBuy = Number((await getAccount(connection, aliceUsdc.address)).amount) / 1e6;
  console.log(`alice USDC before buy: ${beforeBuy}`);

  // --- place_buy: order_id must equal the market's current counter ---
  const m0 = await program.account.market.fetch(market);
  const orderId = m0.orderSeq.toNumber();
  const [order] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), market.toBuffer(), new anchor.BN(orderId).toArrayLike(Buffer, "le", 8)], program.programId
  );
  const [holding] = PublicKey.findProgramAddressSync(
    [Buffer.from("holding"), market.toBuffer(), alice.publicKey.toBuffer()], program.programId
  );

  const AMOUNT = USDC(1_000);   // spend up to 1,000 USDC
  const LIMIT = USDC(60);       // pay at most 60 USDC per share
  const MIN_OUT = USDC(15);     // accept no fewer than 15 shares
  const sig = await program.methods
    .placeBuy(new anchor.BN(orderId), AMOUNT, LIMIT, MIN_OUT)
    .accountsPartial({
      market, order, holding, traderAccount,
      traderUsdc: aliceUsdc.address, marketUsdc,
      trader: alice.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([alice])
    .rpc();
  console.log("\nplace_buy tx:", sig);

  // --- proof: USDC left alice, landed in escrow, order is Pending ---
  const o = await program.account.order.fetch(order);
  const m1 = await program.account.market.fetch(market);
  const aliceAfter = Number((await getAccount(connection, aliceUsdc.address)).amount) / 1e6;
  const escrow = Number((await getAccount(connection, marketUsdc)).amount) / 1e6;

  console.log("\n=== Order on devnet ===");
  console.log("order_id       :", o.orderId.toString());
  console.log("side / status  :", Object.keys(o.side)[0], "/", Object.keys(o.status)[0]);
  console.log("usdc_amount    :", o.usdcAmount.toNumber() / 1e6, "USDC escrowed");
  console.log("limit_price    :", o.limitPrice.toNumber() / 1e6, "USDC/share");
  console.log("min_shares_out :", o.minSharesOut.toNumber() / 1e6);
  console.log("fee_bps snap   :", o.feeBps);
  console.log("\n=== Balances moved ===");
  console.log(`alice USDC   : ${beforeBuy} -> ${aliceAfter}  (-${beforeBuy - aliceAfter})`);
  console.log(`market escrow: ${escrow} USDC`);
  console.log(`market.usdc_escrowed (accounted): ${m1.usdcEscrowed.toNumber() / 1e6}`);
  console.log(`market.order_seq: ${m0.orderSeq.toString()} -> ${m1.orderSeq.toString()}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
