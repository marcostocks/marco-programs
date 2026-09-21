/**
 * Are the vault's claim (receipt) tokens transferable right now? Read-only.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/check-lock-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

const V = require("./devnet-vault.json");

function loadWallet() {
  const p = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`).replace(/^~/, os.homedir());
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main() {
  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(loadWallet()), { commitment: "confirmed" });
  const program = new Program<MarcoVault>(idl as MarcoVault, provider);

  const vault = new PublicKey(V.vault);
  const shareMint = new PublicKey(V.shareMint);

  const v = await program.account.vault.fetch(vault);
  console.log("=== Vault flag ===");
  console.log("vault PDA       :", vault.toBase58());
  console.log("phase           :", Object.keys(v.phase)[0]);
  console.log("transfer_lock   :", v.transferLock, v.transferLock ? "(locked — program re-freezes on every mint)" : "(UNLOCKED)");

  const mintInfo: any = (await connection.getParsedAccountInfo(shareMint)).value?.data;
  const mi = mintInfo.parsed.info;
  console.log("\n=== Claim-token mint ===");
  console.log("mint            :", shareMint.toBase58());
  console.log("supply          :", Number(mi.supply) / 1e6);
  console.log("mint authority  :", mi.mintAuthority);
  console.log("freeze authority:", mi.freezeAuthority, mi.freezeAuthority === vault.toBase58() ? "(= vault PDA — only the program can freeze/thaw)" : "(NOT the vault PDA!)");

  console.log("\n=== Holders (are their accounts frozen?) ===");
  const largest = await connection.getTokenLargestAccounts(shareMint);
  if (!largest.value.length) console.log("(none)");
  for (const { address } of largest.value) {
    const acc: any = (await connection.getParsedAccountInfo(address)).value?.data;
    const info = acc.parsed.info;
    if (Number(info.tokenAmount.amount) === 0) continue;
    console.log(`  ${address.toBase58()}  owner ${info.owner}  bal ${info.tokenAmount.uiAmount}  state=${info.state}${info.state === "frozen" ? " → NON-TRANSFERABLE ✓" : " → TRANSFERABLE ✗"}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
