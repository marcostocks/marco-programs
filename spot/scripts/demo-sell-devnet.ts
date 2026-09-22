/**
 * Live SELL demo on devnet — the round trip, ending in a burn.
 *
 * A fresh trader (Carol) is registered, buys 19 shares and has them confirmed
 * (so she holds frozen position tokens), then SELLS:
 *   place_sell   — tokens move into the market escrow (supply unchanged while
 *                  the share is still custodied).
 *   settle_sell  — broker's proceeds have returned; escrowed tokens are BURNED
 *                  and Carol is paid net of the spread.
 *
 * The buy half is setup; the sell half (steps 4–5 in the log) is the point.
 * We mint the sale proceeds into the market account to simulate the broker
 * wiring cash back before settlement.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/demo-sell-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_spot.json";
import type { MarcoSpot } from "../target/types/marco_spot";

const M = require("./devnet-market.json");
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
const SH = (n: number) => new anchor.BN(Math.round(n * 1e6));
const CUSTODY_REF = Array.from(Buffer.alloc(32, 7));
const DOC_BUY = Array.from(Buffer.alloc(32, 9));
const DOC_SELL = Array.from(Buffer.alloc(32, 5));

function loadWallet() {
  const p = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`).replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}
const ui = (n: bigint | number) => Number(n) / 1e6;

async function main() {
  const admin = loadWallet();
  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<MarcoSpot>(idl as MarcoSpot, provider);

  const market = new PublicKey(M.market);
  const marketUsdc = new PublicKey(M.marketUsdc);
  const positionMint = new PublicKey(M.positionMint);
  const positionEscrow = new PublicKey(M.positionEscrow);
  const usdcMint = new PublicKey(M.usdcMint);
  const destination = new PublicKey(M.settlementDestination);

  const carol = Keypair.generate();
  console.log("trader (carol):", carol.publicKey.toBase58());
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: carol.publicKey, lamports: 0.06 * LAMPORTS_PER_SOL })));

  const [traderAccount] = PublicKey.findProgramAddressSync([Buffer.from("trader"), admin.publicKey.toBuffer(), carol.publicKey.toBuffer()], program.programId);
  const [holding] = PublicKey.findProgramAddressSync([Buffer.from("holding"), market.toBuffer(), carol.publicKey.toBuffer()], program.programId);
  const orderPda = (id: number) => PublicKey.findProgramAddressSync([Buffer.from("order"), market.toBuffer(), new anchor.BN(id).toArrayLike(Buffer, "le", 8)], program.programId)[0];

  await program.methods.registerTrader(true, 344).accountsPartial({ traderAccount, admin: admin.publicKey, trader: carol.publicKey, systemProgram: SystemProgram.programId }).rpc();
  const carolUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, usdcMint, carol.publicKey);
  await mintTo(connection, admin, usdcMint, carolUsdc.address, admin, 5_000 * 1e6);
  const carolPos = await getOrCreateAssociatedTokenAccount(connection, admin, positionMint, carol.publicKey);

  // ---------- SETUP: buy 19 shares and confirm them ----------
  const buyId = (await program.account.market.fetch(market)).orderSeq.toNumber();
  await program.methods.placeBuy(new anchor.BN(buyId), USDC(1000), USDC(60), SH(15)).accountsPartial({
    market, order: orderPda(buyId), holding, traderAccount, traderUsdc: carolUsdc.address, marketUsdc, trader: carol.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([carol]).rpc();
  await program.methods.deployBuy().accountsPartial({ market, order: orderPda(buyId), marketUsdc, destination, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  await program.methods.confirmBuy(SH(19), USDC(50), CUSTODY_REF, DOC_BUY).accountsPartial({
    market, order: orderPda(buyId), holding, positionMint, traderPosition: carolPos.address, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();
  console.log(`\nsetup done — Carol holds ${ui((await getAccount(connection, carolPos.address)).amount)} position tokens (frozen)\n`);

  // ---------- THE SELL ----------
  const supplyBefore = (await program.provider.connection.getTokenSupply(positionMint)).value.uiAmount!;

  // 4) place_sell — escrow the tokens (still not burned)
  const sellId = (await program.account.market.fetch(market)).orderSeq.toNumber();
  const sSig = await program.methods.placeSell(new anchor.BN(sellId), SH(19), USDC(50)).accountsPartial({
    market, order: orderPda(sellId), holding, traderAccount, positionMint, traderPosition: carolPos.address, positionEscrow, trader: carol.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([carol]).rpc();
  const carolAfterPlace = ui((await getAccount(connection, carolPos.address)).amount);
  const escrowAfterPlace = ui((await getAccount(connection, positionEscrow)).amount);
  console.log("4) place_sell tx:", sSig);
  console.log(`   Carol tokens ${carolAfterPlace} · escrow now holds ${escrowAfterPlace} · supply still ${supplyBefore} (share still custodied)`);

  // broker sold the share and wired proceeds back — mint them into the market account
  const PROCEEDS = 1045; // 19 shares @ ~55
  await mintTo(connection, admin, usdcMint, marketUsdc, admin, PROCEEDS * 1e6);

  const carolUsdcBefore = ui((await getAccount(connection, carolUsdc.address)).amount);

  // 5) settle_sell — burn escrow, pay net of spread
  const tSig = await program.methods.settleSell(USDC(PROCEEDS), USDC(55), DOC_SELL).accountsPartial({
    market, order: orderPda(sellId), holding, positionMint, positionEscrow, marketUsdc, traderUsdc: carolUsdc.address, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();
  console.log("\n5) settle_sell tx:", tSig);

  // ---------- proof ----------
  const o = await program.account.order.fetch(orderPda(sellId));
  const supplyAfter = (await program.provider.connection.getTokenSupply(positionMint)).value.uiAmount!;
  const carolUsdcAfter = ui((await getAccount(connection, carolUsdc.address)).amount);
  const escrowAfter = ui((await getAccount(connection, positionEscrow)).amount);

  console.log("\n=== Sell settled ===");
  console.log("order status      :", Object.keys(o.status)[0]);
  console.log("shares sold       :", ui(o.sharesAmount.toNumber()));
  console.log("execution price   :", ui(o.executionPrice.toNumber()), "USDC/share (≥ 50 limit)");
  console.log("\n=== Tokens burned (supply drops by the sold shares) ===");
  console.log(`position escrow   : ${escrowAfterPlace} → ${escrowAfter}  (burned)`);
  console.log(`mint supply       : ${supplyBefore} → ${supplyAfter}  (−${supplyBefore - supplyAfter})`);
  console.log("\n=== Carol paid from proceeds, net of spread ===");
  console.log(`Carol USDC        : ${carolUsdcBefore} → ${carolUsdcAfter}  (+${(carolUsdcAfter - carolUsdcBefore).toFixed(2)})`);
  console.log(`  proceeds ${PROCEEDS} − spread ${(PROCEEDS - (carolUsdcAfter - carolUsdcBefore)).toFixed(2)} = payout ${(carolUsdcAfter - carolUsdcBefore).toFixed(2)}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
