/**
 * Stand up ONE live marco-spot market on devnet, end to end.
 *
 * Creates a test USDC mint (6dp, mint authority = our wallet, so we can fund
 * traders later), derives the four market PDAs, and calls initialize_market
 * on the deployed program. Writes the resulting addresses to
 * scripts/devnet-market.json so register_trader / place_buy can reuse them.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/init-market-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_spot.json";
import type { MarcoSpot } from "../target/types/marco_spot";

const TICKER = "0700.HK"; // Tencent — one market == one HKEX security
const FEE_BPS = 25; // 0.25% trading spread
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));

function loadWallet(): Keypair {
  const path = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`)
    .replace(/^~/, os.homedir());
  const secret = JSON.parse(fs.readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const wallet = loadWallet();
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program<MarcoSpot>(idl as MarcoSpot, provider);

  const admin = wallet; // admin == operator == treasury for a single-operator devnet market
  console.log("cluster   :", connection.rpcEndpoint);
  console.log("program   :", program.programId.toBase58());
  console.log("admin/op  :", admin.publicKey.toBase58());
  console.log("balance   :", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");

  // --- Test USDC mint (we hold mint authority so we can fund traders next) ---
  const usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
  console.log("\ntest USDC :", usdcMint.toBase58());

  // --- Derive the four market PDAs ---
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), admin.publicKey.toBuffer(), Buffer.from(TICKER)],
    program.programId
  );
  const [positionMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("position_mint"), marketPda.toBuffer()],
    program.programId
  );
  const [marketUsdc] = PublicKey.findProgramAddressSync(
    [Buffer.from("market_usdc"), marketPda.toBuffer()],
    program.programId
  );
  const [positionEscrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("position_escrow"), marketPda.toBuffer()],
    program.programId
  );

  // Already initialized? Then just report and exit — the seeds are deterministic.
  const existing = await connection.getAccountInfo(marketPda);
  if (existing) {
    console.log("\nmarket PDA already exists:", marketPda.toBase58(), "— fetching state.");
    const m = await program.account.market.fetch(marketPda);
    console.log(JSON.stringify(m, (_k, v) => (v?.toBase58 ? v.toBase58() : v?.toString?.() ?? v), 2));
    return;
  }

  // --- Immutable conversion-partner USDC account (settlement destination) ---
  const partner = Keypair.generate();
  const partnerUsdc = await createAccount(connection, admin, usdcMint, partner.publicKey);
  console.log("partnerUsdc:", partnerUsdc.toBase58(), "(settlement destination — immutable)");

  // --- initialize_market ---
  const sig = await program.methods
    .initializeMarket({
      ticker: TICKER,
      shareDecimals: 6,
      feeBps: FEE_BPS,
      minOrderUsdc: USDC(10),
      maxOrderUsdc: USDC(500_000),
    })
    .accountsPartial({
      market: marketPda,
      positionMint,
      marketUsdc,
      positionEscrow,
      usdcMint,
      settlementDestination: partnerUsdc,
      admin: admin.publicKey,
      operator: admin.publicKey,
      treasury: admin.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("\ninitialize_market tx:", sig);

  // --- Read it back to prove the on-chain state is real ---
  const m = await program.account.market.fetch(marketPda);
  console.log("\n=== Market on devnet ===");
  console.log("ticker        :", m.ticker);
  console.log("status        :", Object.keys(m.status)[0]);
  console.log("fee_bps       :", m.feeBps);
  console.log("transfer_lock :", m.transferLock);
  console.log("admin         :", m.admin.toBase58());
  console.log("settlement    :", m.settlementDestination.toBase58());
  console.log("position_mint :", m.positionMint.toBase58());
  console.log("market_usdc   :", m.marketUsdc.toBase58());

  const out = {
    cluster: connection.rpcEndpoint,
    programId: program.programId.toBase58(),
    ticker: TICKER,
    market: marketPda.toBase58(),
    positionMint: positionMint.toBase58(),
    marketUsdc: marketUsdc.toBase58(),
    positionEscrow: positionEscrow.toBase58(),
    usdcMint: usdcMint.toBase58(),
    settlementDestination: partnerUsdc.toBase58(),
    admin: admin.publicKey.toBase58(),
    operator: admin.publicKey.toBase58(),
    treasury: admin.publicKey.toBase58(),
    initTx: sig,
  };
  fs.writeFileSync(`${__dirname}/devnet-market.json`, JSON.stringify(out, null, 2));
  console.log("\nwrote scripts/devnet-market.json");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
