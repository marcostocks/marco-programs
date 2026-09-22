/**
 * Read the state of named devnet vaults. Read-only — used to verify the claims
 * on the proof page against chain before publishing them.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npx ts-node scripts/check-vaults.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

const TARGETS: [string, string][] = [
  ["EXITFEE-DEMO-04 (flat)", "4gDCNHPb4n8PxPRztgCRrjc67zuKhvEgDb5WnRKE8xz6"],
  ["EXITFEE-GAIN-02 (+20%)", "9scqYnGfYGDS7CUm4LxFV4EScBMLntjAzSK8fUMEiZA"],
  ["deepseek-2026 (live UI)", "D6ZqeDEjy18dgqYXttCTQyGispeHE3p8L2LEk3RSAqGh"],
  ["moon-2026 (entry-fee)", "6SpMRcq23g7wUZk4PSKgu9EnLuZqiYUFHVCE3fTHZ6rN"],
];

const ui = (n: anchor.BN) => Number(n.toString()) / 1e6;

async function main() {
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8"))),
  );
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed",
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<MarcoVault>(idl as MarcoVault, provider);

  for (const [label, addr] of TARGETS) {
    try {
      const v = await program.account.vault.fetch(new PublicKey(addr));
      console.log(
        `${label}\n  phase ${Object.keys(v.phase)[0]} · fee_at_exit ${v.feeAtExit} · ` +
          `deposits ${ui(v.totalDeposits)} · shares ${ui(v.totalShares)} · ` +
          `redeemedUsdc ${ui(v.totalRedeemedUsdc)} · feesCollected ${ui(v.feesCollected)}`,
      );
    } catch (e) {
      console.log(`${label}\n  ERROR ${(e instanceof Error ? e.message : String(e)).slice(0, 70)}`);
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
