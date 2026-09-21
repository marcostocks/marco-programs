/**
 * Print the time fields a vault actually stores, so the proof page can describe
 * the schedule from chain rather than from prose.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npx ts-node scripts/vault-timeline.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

const T: [string, string][] = [
  ["deepseek-2026 (open)", "D6ZqeDEjy18dgqYXttCTQyGispeHE3p8L2LEk3RSAqGh"],
  ["EXITFEE-GAIN-02 (+20%)", "9scqYnGfYGDS7CUm4LxFV4EScBMLntjAzSK8fUMEiZA"],
];
const iso = (bn: anchor.BN) => {
  const s = Number(bn.toString());
  return s === 0 ? "unset (0)" : new Date(s * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
};
const days = (a: anchor.BN, b: anchor.BN) =>
  ((Number(b.toString()) - Number(a.toString())) / 86400).toFixed(1);

async function main() {
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8"))),
  );
  const conn = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed",
  );
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<MarcoVault>(idl as MarcoVault, provider);

  for (const [label, addr] of T) {
    const v = await program.account.vault.fetch(new PublicKey(addr));
    console.log(`\n${label}  ·  phase ${Object.keys(v.phase)[0]}`);
    console.log(`  funding_start      ${iso(v.fundingStart)}`);
    console.log(`  funding_deadline   ${iso(v.fundingDeadline)}   (${days(v.fundingStart, v.fundingDeadline)}d subscription window)`);
    console.log(`  election_deadline  ${iso(v.electionDeadline)}   (delivery-election window, set at mark_listed)`);
    console.log(`  close_out_at       ${iso(v.closeOutAt)}   (${days(v.fundingStart, v.closeOutAt)}d from funding start)`);
    console.log(`  transfer_lock      ${v.transferLock}   (claim tokens frozen in holder wallets)`);
    console.log(`  shares_allocated   ${Number(v.sharesAllocated.toString()) / 1e6}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
