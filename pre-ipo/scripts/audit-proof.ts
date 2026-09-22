/**
 * Audit every claim the proof page makes against devnet.
 *
 * A link that resolves is not the same as a link that is CORRECT — "its claim
 * mint" must actually be that vault's claim mint, and "redeemed 950" must be
 * what the vault really paid. This checks identity (does the address hold the
 * role the page assigns it) and arithmetic (do the figures match chain).
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com npx ts-node scripts/audit-proof.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getMint } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import vaultIdl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

const SPOT_IDL = JSON.parse(
  fs.readFileSync(`${__dirname}/../../shared/marco-artifacts/idl/marco_spot.json`, "utf8"),
);
const SPOT = new PublicKey("44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e");
const VAULT = new PublicKey("CgJnDJHjhkMgrkaky3Dp9dD89NzXRMP287bqmgCPMC8q");
const ADMIN = new PublicKey("DAVKK3RoykYciooErx8yiRTPvPFdWb68ru8dn9QXqUNm");
const enc = (s: string) => Buffer.from(s);
const ui = (n: anchor.BN | bigint) => Number(n.toString()) / 1e6;

let pass = 0, fail = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = String(actual) === String(expected);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`);
  if (!ok) console.log(`      page says : ${expected}\n      chain says: ${actual}`);
};

async function main() {
  const kp = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8"))),
  );
  const conn = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed",
  );
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const vaultProg = new Program<MarcoVault>(vaultIdl as MarcoVault, provider);
  const spotProg = new Program(SPOT_IDL, provider);

  /* ---- SPOT (single-use proof market, one round trip) ------------------ */
  console.log("\nmarco_spot — 3690.HK, Alice's round trip");
  const [market] = PublicKey.findProgramAddressSync([enc("market"), ADMIN.toBuffer(), enc("3690.HK")], SPOT);
  check("Market is the PDA for 3690.HK", market.toBase58(), "HpmDZhyWSbqvyqAtLb2bNEYh37P3RTKdQv2KAs3bXMj7");
  const [posMint] = PublicKey.findProgramAddressSync([enc("position_mint"), market.toBuffer()], SPOT);
  check("Position mint belongs to this market", posMint.toBase58(), "5PvETomYVMSHTCsxvnMS9SZrscXme7jgky8quVMaQWmK");
  const [mktUsdc] = PublicKey.findProgramAddressSync([enc("market_usdc"), market.toBuffer()], SPOT);
  check("USDC escrow belongs to this market", mktUsdc.toBase58(), "8YQGEdsWaj64Xq6sLzFafcLrLRav3aZbET9FCv8q9K8a");
  const [posEsc] = PublicKey.findProgramAddressSync([enc("position_escrow"), market.toBuffer()], SPOT);
  check("Position escrow belongs to this market", posEsc.toBase58(), "7cAu59BFCK3TBJEbVbJprXZXWSJrXCAXgGqWP7ZH1rWb");

  const m = await (spotProg.account as any).market.fetch(market);
  check("MSB is the immutable destination",
    m.settlementDestination.toBase58(), "5egyX32M3i4UzbCSfJNTwFn1ats2yjSotnVDmRoCRVJn");
  check("Market fee is 25 bps", m.feeBps, 25);

  console.log("\nmarco_spot — final balances the page states");
  check("position supply is 0 (minted 7, burned 7)", ui((await getMint(conn, posMint)).supply), 0);
  check("position escrow is 0", ui((await getAccount(conn, posEsc)).amount), 0);
  check("USDC escrow holds both spreads", ui((await getAccount(conn, mktUsdc)).amount), 5.125);
  check("MSB holds one deployment",
    ui((await getAccount(conn, new PublicKey(m.settlementDestination))).amount), 997.5);

  console.log("\nmarco_spot — Alice's wallet");
  const aliceUsdc = await getAccount(conn, new PublicKey("BwSiMWUgmGzbsqkauZJCQsgS67hnMXyuSjd8JPaD5TjQ"));
  check("Alice's USDC is 5,047.375 (realised +47.375)", ui(aliceUsdc.amount), 5047.375);
  check("  ↳ owned by Alice's wallet", aliceUsdc.owner.toBase58(), "8dwM9QKwRmuAuP5CQbyyEGK4zQgFBX4wwsPT49dLb8wL");
  const alicePos = await getAccount(conn, new PublicKey("3KbYo2e2UEjhgxdqMjkQ7aaZNpXF3fXKYK1ARMtqeApm"));
  check("Alice's position tokens are 0 (burned on the sale)", ui(alicePos.amount), 0);
  check("  ↳ it is a 3690.HK position account", alicePos.mint.toBase58(), posMint.toBase58());

  /* ---- VAULTS ---------------------------------------------------------- */
  // Only the vaults the page actually cites. The page walks a single completed
  // deal (the +20% outcome) plus the vault currently open for subscription.
  const vaults: [string, string, { deposits: number; redeemed: number; fees: number; usdc: string; mintAddr: string; broker?: string; phase: string; shares?: number }][] = [
    ["EXITFEE-GAIN-02", "9scqYnGfYGDS7CUm4LxFV4EScBMLntjAzSK8fUMEiZA",
      { deposits: 1000, redeemed: 1140, fees: 60, usdc: "8uKpqd5A2CrpdYmqpWPfUpQhbCpChny9hWMjv278TJKa",
        mintAddr: "7WHWPd1s4xxmzxcoVWKTjx2rFeUBjBNrD3zEauedLJ2o",
        broker: "aQZ6uSqts7Lymxpub73XxRMcRBwsGEKdomSFyeBLKZC", phase: "claimable", shares: 100 }],
    ["deepseek-2026", "D6ZqeDEjy18dgqYXttCTQyGispeHE3p8L2LEk3RSAqGh",
      { deposits: 0, redeemed: 0, fees: 0, usdc: "", mintAddr: "", phase: "funding" }],
  ];

  for (const [id, addr, want] of vaults) {
    console.log(`\nmarco_vault — ${id}`);
    const [derived] = PublicKey.findProgramAddressSync([enc("vault"), ADMIN.toBuffer(), enc(id)], VAULT);
    check(`vault address is the PDA for "${id}"`, derived.toBase58(), addr);
    const v = await vaultProg.account.vault.fetch(new PublicKey(addr));
    check("phase", Object.keys(v.phase)[0], want.phase);
    check("exit-fee model is on", v.feeAtExit, true);
    check("total deposited", ui(v.totalDeposits), want.deposits);
    check("total redeemed to holders", ui(v.totalRedeemedUsdc), want.redeemed);
    check("fees collected", ui(v.feesCollected), want.fees);

    if (want.usdc) {
      check("linked USDC account is this vault's", v.vaultUsdc.toBase58(), want.usdc);
      const bal = ui((await getAccount(conn, v.vaultUsdc)).amount);
      check("its balance equals the unswept fee", bal, want.fees);
    }
    if (want.mintAddr) {
      const [sm] = PublicKey.findProgramAddressSync([enc("share_mint"), new PublicKey(addr).toBuffer()], VAULT);
      check("linked claim mint is this vault's", sm.toBase58(), want.mintAddr);
      check("claim supply burned to zero", ui((await getMint(conn, sm)).supply), 0);
    }
    if (want.broker) check("linked broker is the immutable destination", v.depositDestination.toBase58(), want.broker);
    if (want.shares !== undefined) check("shares recorded at listing", Number(v.sharesAllocated.toString()) / 1e6, want.shares);
  }

  // Dave's own accounts, linked from the subscribe/redeem rows. Identity first:
  // a link that resolves but points at the wrong account is the failure mode here.
  console.log("\nDave — the wallet that ran the completed deal");
  const DAVE = new PublicKey("AtgSRzW4QK12TN9jjpwewwLa99kEA6jQHcBhm1QraX9R");
  const daveUsdc = await getAccount(conn, new PublicKey("B4t2xWfHNWJrEUW5xdFDPz6afBmnASmEpa1BMWcNo2Fx"));
  check("Dave's USDC is $2,140 (realised +$140)", ui(daveUsdc.amount), 2140);
  check("  ↳ owned by Dave's wallet", daveUsdc.owner.toBase58(), DAVE.toBase58());
  check("  ↳ it is a USDC account", daveUsdc.mint.toBase58(), "C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef");
  const daveShares = await getAccount(conn, new PublicKey("9jGE4oQdrKBVAsuZSCWvcCEWU73Qx9svxuLcTjKuZGqZ"));
  check("Dave's claim tokens are 0 (burned on redemption)", ui(daveShares.amount), 0);
  check("  ↳ owned by Dave's wallet", daveShares.owner.toBase58(), DAVE.toBase58());
  check("  ↳ it is an EXITFEE-GAIN-02 claim account", daveShares.mint.toBase58(),
    "7WHWPd1s4xxmzxcoVWKTjx2rFeUBjBNrD3zEauedLJ2o");

  /* ---- TRANSACTIONS ---------------------------------------------------- */
  console.log("\nTransactions the page links");
  const txs: [string, string][] = [
    ["place_buy", "3PLQQZLuFR3N6bNdti7Fs8qpo4uUH5Tb2pxZsqH5q9LhHeoDe6UrKWcrJHeQAwpPWZ1khtLLpxwH8CaLhbzhxoBF"],
    ["deploy_buy", "3pBCiTuue4Uan8Q4119G2LqYwHpckhtPGgrrEAFbmm5EGqBm3XzXfVMaeXTW9GoW5vuWBJwfNkGhc4U4fRZ2Q8nk"],
    ["confirm_buy", "4tEjCpA8kRyxzdnR8EFEiQ1ZzA2NFFoJdY1zjcEAZ1zsgfgw6qk7eej3r1z7ivrVg5D6GnQaGikkK6x9LXhnJVWL"],
    ["place_sell", "5y23XouswLJPLQjDsSgVHCHS7LcbgxwYAosfoE9d9JP8yRAyPRVZgSZC6ED6XcPTBHHaM1B4wX1DwE9cNXGCYs1L"],
    ["settle_sell", "qHs2NRUUPL9qAe2uyQhNY8VUofPxJCFmCvUCqrAC3Qf4oFKCmoA6QDmseT74ouNk4JUXXTE16oh8ZQ3iPbF2KUM"],
    ["deposit", "2ifgfocMyXDmCebuR6awuYo2LZQ3Veg9FkWJn5pMAb2gBb591Y37qyoKREpR1Pdqr82VJH9YS4S1ZXu9tjmypEpr"],
    ["deploy_capital", "2apYV7oZVAbUeH6GvW5Huf9WoU4BxGUqPeFdBRksLoWThFML1ZPA38DAU9VcNvSLm4c44upynKinJepETLUSFnnZ"],
    ["settle", "5HJo9FUWXB9jXpADC95ZtgQYH3kZ5EJbfJWjqMXDmxbik6BqhS4rJz82WjJjaqhQgMZSVWbXCE8KBfwEhUyjWLu"],
    ["claim", "36ECFZe9bJxoLJjVqtemhVdd2JMHBwD93NNP3hoXu6yKZ2tpMWovEMiEj41NiP7DRb3nWxy3GRam44uDS2MqNES5"],
  ];

  // The lifecycle table no longer links each transition — too much noise for a
  // conceptual table. The page still ASSERTS the vault walked these phases, so
  // they stay audited here; they are simply not expected to appear as links.
  const phaseTxs: [string, string][] = [
    ["open_funding", "4QFyrr3UXKKGoi5z9sCCvmgJsvMUGJ1j5zA4L1jZx7RkBC3zKtvEy6xRgB3naCZkAuh5nswNGfYNCYXRXqC1KBz5"],
    ["seal_funding", "TNSuhE7AXSZqjknsxUykw7VpymJo5exNiu5a4sRQPSLxKC4jL7JYc7epHfBZfDanTCfkwSLDgVijZBkzqFHttox"],
    ["begin_sourcing", "4FinZ9SedvkYcFNYqNkEcy6H9NKHVh5R9nj5bNeritoEYRatFYNeSNJu2g22P9fzNV4zipG8TjjJsvVLb3WugLLU"],
    ["confirm_allocation", "4347k2mXcxYS42BuAwNJvZmVdr34HZNdMwUUjfneCh2cjZfGnKE93ExUXbaNz2x1poGtrUo6nNYvgvYWjoungkEW"],
    ["mark_listed", "5LYFF9R24gSVhmXJsg7oCFvshygQXM7xSg7En49swd2rF1aVxyuWGfbTAmpEdUyn6gA94JuT8nNuEBS4q8uqAZpy"],
    ["mark_realized", "5m2Q8AFDQoyhowBpz2upTAV6r3GPt2A5Q2GXArjqsjtXBM1K8kXyFUrUkN1q9gzuruWqdS7VrENeR4vJHFzrZEmL"],
  ];
  const all = [...txs, ...phaseTxs];
  const statuses = await conn.getSignatureStatuses(all.map(([, s]) => s), { searchTransactionHistory: true });
  all.forEach(([label], i) => {
    const st = statuses.value[i];
    const linked = i < txs.length;
    check(`${label} is confirmed and did not error${linked ? "" : "  (phase transition, not linked)"}`,
      st ? (st.err ? "ERRORED" : "confirmed") : "NOT FOUND", "confirmed");
  });

  /* ---- LINK COVERAGE + LABEL CONSISTENCY -------------------------------- */
  // Two failure modes this catches, both of which have bitten this page before:
  //   1. a link is added to the page but nothing here verifies where it points
  //   2. the displayed "AbCdEf…xyz" text drifts from the href it sits next to
  console.log("\nLinks on the page");
  const html = fs.readFileSync(`${__dirname}/../../proof/marco-proof.html`, "utf8");
  const linkedAddrs = new Set([...html.matchAll(/explorer\.solana\.com\/address\/([1-9A-HJ-NP-Za-km-z]{32,44})/g)].map((m) => m[1]));
  const linkedTxs = new Set([...html.matchAll(/explorer\.solana\.com\/tx\/([1-9A-HJ-NP-Za-km-z]{60,})/g)].map((m) => m[1]));

  const auditedTxs = new Set(all.map(([, s]) => s));
  const unaudited = [...linkedTxs].filter((t) => !auditedTxs.has(t));
  check("every linked transaction is audited above", unaudited.length ? unaudited.join(", ") : "none", "none");
  // phaseTxs are deliberately unlinked, so only the `txs` set must appear on the page
  check("every page-facing transaction is still linked",
    txs.map(([, s]) => s).filter((t) => !linkedTxs.has(t)).join(", ") || "none", "none");

  const auditedAddrs = new Set<string>([
    SPOT.toBase58(), VAULT.toBase58(),
    "HpmDZhyWSbqvyqAtLb2bNEYh37P3RTKdQv2KAs3bXMj7", "5PvETomYVMSHTCsxvnMS9SZrscXme7jgky8quVMaQWmK",
    "8YQGEdsWaj64Xq6sLzFafcLrLRav3aZbET9FCv8q9K8a", "7cAu59BFCK3TBJEbVbJprXZXWSJrXCAXgGqWP7ZH1rWb",
    "5egyX32M3i4UzbCSfJNTwFn1ats2yjSotnVDmRoCRVJn", "8dwM9QKwRmuAuP5CQbyyEGK4zQgFBX4wwsPT49dLb8wL",
    "BwSiMWUgmGzbsqkauZJCQsgS67hnMXyuSjd8JPaD5TjQ", "3KbYo2e2UEjhgxdqMjkQ7aaZNpXF3fXKYK1ARMtqeApm",
    "9scqYnGfYGDS7CUm4LxFV4EScBMLntjAzSK8fUMEiZA", "8uKpqd5A2CrpdYmqpWPfUpQhbCpChny9hWMjv278TJKa",
    "7WHWPd1s4xxmzxcoVWKTjx2rFeUBjBNrD3zEauedLJ2o", "aQZ6uSqts7Lymxpub73XxRMcRBwsGEKdomSFyeBLKZC",
    "D6ZqeDEjy18dgqYXttCTQyGispeHE3p8L2LEk3RSAqGh",
    "C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef", // test USDC mint — asserted above as Alice's and Dave's mint
    DAVE.toBase58(), "B4t2xWfHNWJrEUW5xdFDPz6afBmnASmEpa1BMWcNo2Fx",
    "9jGE4oQdrKBVAsuZSCWvcCEWU73Qx9svxuLcTjKuZGqZ",
  ]);
  const strayAddrs = [...linkedAddrs].filter((a) => !auditedAddrs.has(a));
  check("every linked address is audited above", strayAddrs.join(", ") || "none", "none");

  // `<td class="addr">AbCdEf…xyz</td>` followed by its own href in the next cell
  let labelRows = 0;
  for (const m of html.matchAll(/<td class="addr">([1-9A-HJ-NP-Za-km-z]+)…([1-9A-HJ-NP-Za-km-z]+)<\/td>\s*<td><a href="[^"]*\/address\/([1-9A-HJ-NP-Za-km-z]{32,44})/g)) {
    const [, head, tail, full] = m;
    labelRows++;
    if (!full.startsWith(head) || !full.endsWith(tail)) {
      check(`index label ${head}…${tail} matches its link`, full, `${head}…${tail}`);
    }
  }
  check(`all ${labelRows} index labels match their links`, "consistent", "consistent");

  // Devnet is reset periodically, so the page ships an offline snapshot and every
  // link carries a fallback to it. A link added later with no archived record
  // would look fine today and die silently at the next reset — catch it here.
  console.log("\nOffline archive");
  const archive = JSON.parse(fs.readFileSync(`${__dirname}/../../proof/marco-proof-archive.json`, "utf8"));
  const archivedTxs = new Set<string>(Object.values(archive.transactions).map((t: any) => t.signature));
  const archivedAddrs = new Set<string>(Object.keys(archive.accounts));
  check("every linked transaction has an archived copy",
    [...linkedTxs].filter((t) => !archivedTxs.has(t)).join(", ") || "none", "none");
  check("every linked address has an archived copy",
    [...linkedAddrs].filter((a) => !archivedAddrs.has(a)).join(", ") || "none", "none");
  check("no archived transaction errored",
    Object.entries(archive.transactions).filter(([, t]: any) => t.err).map(([k]) => k).join(", ") || "none", "none");

  // The archive is only worth anything if it agrees with the chain it claims to
  // mirror; a stale capture is worse than none.
  const spotChecks: [string, string, number][] = [
    ["Alice's USDC", "BwSiMWUgmGzbsqkauZJCQsgS67hnMXyuSjd8JPaD5TjQ", 5047.375],
    ["market spread", "8YQGEdsWaj64Xq6sLzFafcLrLRav3aZbET9FCv8q9K8a", 5.125],
    ["MSB deployment", "5egyX32M3i4UzbCSfJNTwFn1ats2yjSotnVDmRoCRVJn", 997.5],
    ["Dave's USDC", "B4t2xWfHNWJrEUW5xdFDPz6afBmnASmEpa1BMWcNo2Fx", 2140],
    ["vault unswept fee", "8uKpqd5A2CrpdYmqpWPfUpQhbCpChny9hWMjv278TJKa", 60],
  ];
  for (const [label, addr, expected] of spotChecks) {
    const rec = archive.accounts[addr];
    check(`archived ${label} matches the page`, rec ? Number(rec.token.amount) / 1e6 : "MISSING", expected);
  }

  const stated = html.match(/sha256\(archive\) = ([0-9a-f]{64})/)?.[1];
  const { sha256: _drop, ...body } = archive;
  const recomputed = require("crypto").createHash("sha256")
    .update(JSON.stringify({ ...body, sha256: archive.sha256 })).digest("hex");
  check("the sha256 printed on the page is the archive's", stated, recomputed);

  console.log(`\n${fail === 0 ? "✓ EVERY LINK AND FIGURE ON THE PROOF PAGE MATCHES CHAIN" : `✗ ${fail} MISMATCH(ES)`}  (${pass} checks passed, ${fail} failed)\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
