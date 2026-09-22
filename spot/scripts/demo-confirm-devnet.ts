/**
 * Carry a Pending buy through to Filled on devnet — the operator side.
 *
 * deploy_buy  : escrowed USDC -> conversion partner, spread retained; Deployed.
 * confirm_buy : attest custody (position ref + doc hash, both non-zero) and
 *               mint the trader's LOCKED position tokens; Filled.
 *
 * Operates on the existing order (default id 0) placed by demo-buy-devnet.ts.
 * Neither step needs the trader's key — the fill is operator-driven, and the
 * trader's position ATA can be created by any payer. Idempotent: it resumes
 * from whatever state the order is already in.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/demo-confirm-devnet.ts [orderId]
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_spot.json";
import type { MarcoSpot } from "../target/types/marco_spot";

const M = require("./devnet-market.json");
const ORDER_ID = Number(process.argv[2] ?? 0);

// Off-chain evidence, fingerprinted on-chain (both must be non-zero).
const CUSTODY_REF = Array.from(Buffer.alloc(32, 7));
const DOC_HASH = Array.from(Buffer.alloc(32, 9));

function loadWallet() {
  const path = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`).replace(/^~/, os.homedir());
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
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
  const positionMint = new PublicKey(M.positionMint);
  const destination = new PublicKey(M.settlementDestination);

  const [order] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), market.toBuffer(), new anchor.BN(ORDER_ID).toArrayLike(Buffer, "le", 8)], program.programId
  );
  let o = await program.account.order.fetch(order);
  const trader = o.trader;
  const [holding] = PublicKey.findProgramAddressSync(
    [Buffer.from("holding"), market.toBuffer(), trader.toBuffer()], program.programId
  );
  console.log(`order #${ORDER_ID}: status ${Object.keys(o.status)[0]} | trader ${trader.toBase58()} | ${o.usdcAmount.toNumber() / 1e6} USDC`);

  const partnerBefore = Number((await getAccount(connection, destination)).amount) / 1e6;

  // --- deploy_buy (Pending -> Deployed) ---
  if (Object.keys(o.status)[0] === "pending") {
    const sig = await program.methods.deployBuy().accountsPartial({
      market, order, marketUsdc, destination, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    console.log("\ndeploy_buy tx:", sig);
    o = await program.account.order.fetch(order);
    console.log(`  -> Deployed | ${o.deployedAmount.toNumber() / 1e6} USDC to partner | spread kept ${o.feePaid.toNumber() / 1e6}`);
  }

  // trader's position token account (create for them — no trader signature needed)
  const traderPos = await getOrCreateAssociatedTokenAccount(connection, admin, positionMint, trader);

  // --- confirm_buy (Deployed -> Filled): attest custody, mint locked position ---
  if (Object.keys(o.status)[0] === "deployed") {
    const SHARES = new anchor.BN(19 * 1e6);       // 19.0 shares acquired...
    const EXEC = new anchor.BN(50 * 1e6);         // ...at 50 USDC/share (<= 60 limit); notional 950 <= 995 deployed
    const sig = await program.methods.confirmBuy(SHARES, EXEC, CUSTODY_REF, DOC_HASH).accountsPartial({
      market, order, holding, positionMint, traderPosition: traderPos.address,
      adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    console.log("\nconfirm_buy tx:", sig);
  }

  // --- proof ---
  o = await program.account.order.fetch(order);
  const m = await program.account.market.fetch(market);
  const pos = await getAccount(connection, traderPos.address);
  const mint = await program.provider.connection.getParsedAccountInfo(positionMint);
  const supply = (mint.value?.data as any).parsed.info.supply / 1e6;
  const partnerAfter = Number((await getAccount(connection, destination)).amount) / 1e6;
  const escrow = Number((await getAccount(connection, marketUsdc)).amount) / 1e6;

  console.log("\n=== Order filled ===");
  console.log("status            :", Object.keys(o.status)[0]);
  console.log("shares_amount     :", o.sharesAmount.toNumber() / 1e6);
  console.log("execution_price   :", o.executionPrice.toNumber() / 1e6, "USDC/share");
  console.log("custody_ref set   :", !o.custodyRef.every((b: number) => b === 0));
  console.log("doc_hash set      :", !o.docHash.every((b: number) => b === 0));
  console.log("\n=== Position token (the receipt) ===");
  console.log(`trader position   : ${Number(pos.amount) / 1e6} tokens  (frozen: ${pos.isFrozen})`);
  console.log(`position_mint supply: ${supply}  (== custodied shares)`);
  console.log(`market.total_shares_outstanding: ${m.totalSharesOutstanding.toNumber() / 1e6}`);
  console.log("\n=== USDC settled ===");
  console.log(`conversion partner: ${partnerBefore} -> ${partnerAfter}  (+${partnerAfter - partnerBefore})`);
  console.log(`market escrow now : ${escrow} USDC`);
  console.log(`fees_collected    : ${m.feesCollected.toNumber() / 1e6} USDC (spread, awaiting sweep)`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
