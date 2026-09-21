/**
 * Build a single-use spot market for the proof page.
 *
 * The live 0700.HK market keeps trading, so its pooled accounts — position
 * mint, USDC escrow, position escrow — never match a historical figure. This
 * creates a dedicated market, runs exactly two positions through it, and is
 * then never touched again, so every account it owns has a FINAL value the
 * proof page can state and link:
 *
 *   holder A  buys 19 and keeps them      → their account: 19, frozen (forever)
 *   holder B  buys 19 then sells them     → their account: 0
 *
 *   position mint supply   19   (A's holding — supply == shares in custody)
 *   position escrow         0   (B's tokens were burned at settlement)
 *   USDC escrow        15.225   (spread retained: 5 + 5 + 5.225)
 *
 * Every signature is captured so the page can link each instruction.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/proof-market-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, createAccount, getOrCreateAssociatedTokenAccount, mintTo, getAccount, getMint,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_spot.json";
import type { MarcoSpot } from "../target/types/marco_spot";

process.on("unhandledRejection", (r) =>
  console.log(`   … survived RPC rejection: ${(r as Error)?.message?.slice(0, 70)}`));

const TICKER = "3690.HK";          // Meituan HK — a market used once, for proof
// Fill prices are chosen so the arithmetic closes exactly: after the 25 bps
// spread, 997.50 is deployed and 7 shares @ 142.50 is exactly 997.50.
const FEE_BPS = 25; // 0.25% trading spread
const USDC_MINT = new PublicKey("C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef");
const U = (n: number) => new anchor.BN(Math.round(n * 1e6));
const ui = (n: bigint | number) => Number(n) / 1e6;
const CUSTODY = Array.from(Buffer.alloc(32, 7));
const DOC_BUY = Array.from(Buffer.alloc(32, 9));
const DOC_SELL = Array.from(Buffer.alloc(32, 5));
const ok = (t: string) => console.log(`   ✓ ${t}`);

async function retry<T>(fn: () => Promise<T>, n = 7): Promise<T> {
  let d = 700;
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (i >= n || !/429|Too Many|fetch failed|ECONN|blockhash|Node is behind|50[234]/i.test(m)) throw e;
      await new Promise((r) => setTimeout(r, d)); d = Math.min(d * 2, 6000);
    }
  }
}

function loadWallet() {
  const p = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`).replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main() {
  const admin = loadWallet();
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<MarcoSpot>(idl as MarcoSpot, provider);
  const P = program.programId;
  const seed = (s: string) => Buffer.from(s);

  const [market] = PublicKey.findProgramAddressSync([seed("market"), admin.publicKey.toBuffer(), seed(TICKER)], P);
  const [positionMint] = PublicKey.findProgramAddressSync([seed("position_mint"), market.toBuffer()], P);
  const [marketUsdc] = PublicKey.findProgramAddressSync([seed("market_usdc"), market.toBuffer()], P);
  const [positionEscrow] = PublicKey.findProgramAddressSync([seed("position_escrow"), market.toBuffer()], P);
  const orderPda = (id: number) => PublicKey.findProgramAddressSync(
    [seed("order"), market.toBuffer(), new anchor.BN(id).toArrayLike(Buffer, "le", 8)], P)[0];
  const holdingOf = (w: PublicKey) => PublicKey.findProgramAddressSync(
    [seed("holding"), market.toBuffer(), w.toBuffer()], P)[0];
  const traderOf = (w: PublicKey) => PublicKey.findProgramAddressSync(
    [seed("trader"), admin.publicKey.toBuffer(), w.toBuffer()], P)[0];

  if (await connection.getAccountInfo(market)) {
    console.error(`market ${TICKER} already exists at ${market.toBase58()} — pick another ticker`);
    process.exit(1);
  }

  const sig: Record<string, string> = {};

  // ── create the market ───────────────────────────────────────────────────
  const partner = Keypair.generate();
  const partnerUsdc = await retry(() => createAccount(connection, admin, USDC_MINT, partner.publicKey));
  sig.initializeMarket = await retry(() => program.methods.initializeMarket({
    ticker: TICKER, shareDecimals: 6, feeBps: FEE_BPS, minOrderUsdc: U(10), maxOrderUsdc: U(500_000),
  }).accountsPartial({
    market, positionMint, marketUsdc, positionEscrow, usdcMint: USDC_MINT,
    settlementDestination: partnerUsdc, admin: admin.publicKey, operator: admin.publicKey, treasury: admin.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }).rpc());
  ok(`market ${TICKER} created · ${market.toBase58()}`);

  // ── two holders ─────────────────────────────────────────────────────────
  const mk = async (label: string) => {
    const kp = Keypair.generate();
    await retry(() => provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({
      fromPubkey: admin.publicKey, toPubkey: kp.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }))));
    await retry(() => program.methods.registerTrader(true, 344).accountsPartial({
      traderAccount: traderOf(kp.publicKey), admin: admin.publicKey, trader: kp.publicKey,
      systemProgram: SystemProgram.programId }).rpc());
    const usdc = (await retry(() => getOrCreateAssociatedTokenAccount(connection, admin, USDC_MINT, kp.publicKey))).address;
    await retry(() => mintTo(connection, admin, USDC_MINT, usdc, admin, 5_000 * 1e6));
    const pos = (await retry(() => getOrCreateAssociatedTokenAccount(connection, admin, positionMint, kp.publicKey))).address;
    ok(`${label} ${kp.publicKey.toBase58().slice(0, 8)}… registered · position acct ${pos.toBase58().slice(0, 8)}…`);
    return { kp, usdc, pos };
  };
  const A = await mk("Alice (buys, then sells the same position)");

  // ── buy + confirm, for one holder ───────────────────────────────────────
  const buy = async (h: typeof A, tag: string) => {
    const id = Number((await retry(() => program.account.market.fetch(market))).orderSeq.toString());
    sig[`placeBuy_${tag}`] = await retry(() => program.methods
      .placeBuy(new anchor.BN(id), U(1000), U(150), U(6))
      .accountsPartial({ market, order: orderPda(id), holding: holdingOf(h.kp.publicKey),
        traderAccount: traderOf(h.kp.publicKey), traderUsdc: h.usdc, marketUsdc,
        trader: h.kp.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .signers([h.kp]).rpc());
    sig[`deployBuy_${tag}`] = await retry(() => program.methods.deployBuy().accountsPartial({
      market, order: orderPda(id), marketUsdc, destination: partnerUsdc,
      adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
    sig[`confirmBuy_${tag}`] = await retry(() => program.methods
      .confirmBuy(U(7), U(142.5), CUSTODY, DOC_BUY)
      .accountsPartial({ market, order: orderPda(id), holding: holdingOf(h.kp.publicKey),
        positionMint, traderPosition: h.pos, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc());
    ok(`${tag}: buy #${id} filled — 7 tokens @ 142.50, 997.50 deployed, 2.50 spread`);
    return id;
  };
  await buy(A, "A");

  // ── holder B closes the position ────────────────────────────────────────
  const sellId = Number((await retry(() => program.account.market.fetch(market))).orderSeq.toString());
  sig.placeSell = await retry(() => program.methods.placeSell(new anchor.BN(sellId), U(7), U(140))
    .accountsPartial({ market, order: orderPda(sellId), holding: holdingOf(A.kp.publicKey),
      traderAccount: traderOf(A.kp.publicKey), positionMint, traderPosition: A.pos, positionEscrow,
      trader: A.kp.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([A.kp]).rpc());
  ok(`sell #${sellId} placed — 7 tokens escrowed, supply still ${ui((await getMint(connection, positionMint)).supply)}`);

  // Broker returns the sale proceeds; settle_sell requires them present as
  // unreserved balance before it will pay the seller.
  const PROCEEDS = 1050;
  await retry(() => mintTo(connection, admin, USDC_MINT, marketUsdc, admin, PROCEEDS * 1e6));
  sig.settleSell = await retry(() => program.methods.settleSell(U(PROCEEDS), U(150), DOC_SELL)
    .accountsPartial({ market, order: orderPda(sellId), holding: holdingOf(A.kp.publicKey),
      positionMint, positionEscrow, marketUsdc, traderUsdc: A.usdc,
      adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
  ok(`sell #${sellId} settled — escrowed tokens burned, seller paid net of spread`);

  // ── final state: this market is never touched again ─────────────────────
  const finalSupply = ui((await retry(() => getMint(connection, positionMint))).supply);
  const finalEscrowUsdc = ui((await retry(() => getAccount(connection, marketUsdc))).amount);
  const finalPosEscrow = ui((await retry(() => getAccount(connection, positionEscrow))).amount);
  const aBal = await retry(() => getAccount(connection, A.pos));
  
  const partnerBal = ui((await retry(() => getAccount(connection, partnerUsdc))).amount);

  console.log("\n=== FINAL STATE (this market is now closed to further use) ===");
  console.log(`position mint supply : ${finalSupply}      (holder A's position)`);
  console.log(`Alice position       : ${ui(aBal.amount)}  frozen=${aBal.isFrozen}`);
  const aUsdc = ui((await retry(() => getAccount(connection, A.usdc))).amount);
  console.log(`Alice USDC           : ${aUsdc}  (started 5,000 → profit ${(aUsdc-5000).toFixed(3)})`);
  console.log(`position escrow      : ${finalPosEscrow}       (burned at settlement)`);
  console.log(`USDC escrow          : ${finalEscrowUsdc}  (spread retained)`);
  console.log(`MSB                  : ${partnerBal}     (one deployment)`);

  const out = {
    cluster: connection.rpcEndpoint, ticker: TICKER, programId: P.toBase58(),
    market: market.toBase58(), positionMint: positionMint.toBase58(),
    marketUsdc: marketUsdc.toBase58(), positionEscrow: positionEscrow.toBase58(),
    settlementDestination: partnerUsdc.toBase58(), usdcMint: USDC_MINT.toBase58(),
    alice: { wallet: A.kp.publicKey.toBase58(), position: A.pos.toBase58(), usdc: A.usdc.toBase58() },
    final: { positionSupply: finalSupply, alicePosition: ui(aBal.amount),
      aliceUsdc: ui((await retry(() => getAccount(connection, A.usdc))).amount),
      positionEscrow: finalPosEscrow, usdcEscrow: finalEscrowUsdc, msb: partnerBal },
    signatures: sig,
  };
  fs.writeFileSync(`${__dirname}/devnet-proof-${TICKER}.json`, JSON.stringify(out, null, 2));
  console.log("\nwrote scripts/devnet-proof-market.json");
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
