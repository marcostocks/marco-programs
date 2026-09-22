/**
 * Prove the exit-fee vault model on devnet.
 *
 * A fresh vault is flipped to fee-at-exit BEFORE any deposit (set_fee_timing),
 * so:
 *   deposit 1,000 USDC  -> 1,000 claim tokens (1:1 with the GROSS, no entry fee)
 *   redeem  1,000 tokens -> 950 USDC          (5% taken from the redemption)
 *
 * The deal is deliberately flat (proceeds == deployed) so the numbers read
 * exactly as the spec: $1,000 in, $1,000 of tokens, $950 back. The 50 stays in
 * the vault as collected fee for the treasury to sweep.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/demo-exit-fee-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAccount, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

// The public devnet RPC surfaces confirmation failures as unhandled rejections
// outside the await chain; log and survive rather than dying mid-drive.
process.on("unhandledRejection", (r) => console.log(`   … survived RPC rejection: ${(r as Error)?.message?.slice(0, 80)}`));

const TEST_USDC = new PublicKey("C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef");
const VAULT_ID = "EXITFEE-DEMO-04";
async function retry<T>(fn: () => Promise<T>, n = 6): Promise<T> {
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
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
const DAY = 86400;
const ui = (n: bigint | number) => Number(n) / 1e6;
const ok = (t: string) => console.log(`   ✓ ${t}`);
const bad = (t: string): never => { throw new Error(`✗ ${t}`); };

function loadWallet() {
  const p = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`).replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main() {
  const admin = loadWallet();
  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program<MarcoVault>(idl as MarcoVault, provider);

  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)], program.programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), vault.toBuffer()], program.programId);
  if (await connection.getAccountInfo(vault)) bad(`vault ${VAULT_ID} already exists — pick a new id`);

  // ---- create the vault, then flip it to exit-fee BEFORE any deposit ----
  const vaultUsdc = await createAccount(connection, admin, TEST_USDC, vault, Keypair.generate());
  const broker = Keypair.generate();
  const brokerUsdc = await createAccount(connection, admin, TEST_USDC, broker.publicKey);
  const now = Math.floor(Date.now() / 1000);
  await program.methods.initializeVault({
    vaultId: VAULT_ID, depositCap: USDC(1_000_000), minDeposit: USDC(100), maxDeposit: USDC(100_000),
    fundingStart: new anchor.BN(now), fundingDeadline: new anchor.BN(now + 30 * DAY), closeOutAt: new anchor.BN(now + 365 * DAY), feeBps: 500,
  }).accountsPartial({
    vault, shareMint, vaultUsdc, depositDestination: brokerUsdc, admin: admin.publicKey, operator: admin.publicKey, treasury: admin.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }).rpc();

  await program.methods.setFeeTiming(true).accountsPartial({ vault, admin: admin.publicKey }).rpc();
  const v0 = await program.account.vault.fetch(vault);
  if (!v0.feeAtExit) bad("set_fee_timing did not set fee_at_exit");
  ok(`vault ${VAULT_ID} created · fee_at_exit = ${v0.feeAtExit} · fee ${v0.feeBps}bps`);

  await program.methods.openFunding().accountsPartial({ vault, admin: admin.publicKey }).rpc();

  // ---- Dave subscribes 1,000 → expect 1,000 tokens (GROSS, no entry fee) ----
  const dave = Keypair.generate();
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: dave.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })));
  const daveUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, TEST_USDC, dave.publicKey);
  await mintTo(connection, admin, TEST_USDC, daveUsdc.address, admin, 2_000 * 1e6);
  const daveShares = await getOrCreateAssociatedTokenAccount(connection, admin, shareMint, dave.publicKey);
  const [buyerState] = PublicKey.findProgramAddressSync([Buffer.from("buyer"), vault.toBuffer(), dave.publicKey.toBuffer()], program.programId);

  await program.methods.deposit(USDC(1000)).accountsPartial({
    vault, buyerState, shareMint, depositorUsdc: daveUsdc.address, vaultUsdc, depositorShares: daveShares.address, depositor: dave.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([dave]).rpc();

  const tokens = ui((await getAccount(connection, daveShares.address)).amount);
  const v1 = await program.account.vault.fetch(vault);
  if (tokens !== 1000) bad(`expected 1,000 tokens for $1,000 (gross), got ${tokens}`);
  if (ui(v1.feesEscrowed.toNumber()) !== 0) bad(`expected 0 fees escrowed at deposit, got ${ui(v1.feesEscrowed.toNumber())}`);
  ok(`deposit 1,000 USDC → ${tokens} claim tokens (1:1 gross, no entry fee · fees_escrowed 0)`);

  // ---- flat deal: deploy the full 1,000, return exactly 1,000 ----
  const A = { vault, admin: admin.publicKey };
  await retry(() => program.methods.sealFunding().accountsPartial(A).rpc());
  await retry(() => program.methods.beginSourcing().accountsPartial(A).rpc());
  await retry(() => program.methods.confirmAllocation(USDC(1000)).accountsPartial(A).rpc());
  await retry(() => program.methods.deployCapital(USDC(1000)).accountsPartial({ vault, vaultUsdc, destination: brokerUsdc, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
  await retry(() => program.methods.markListed(USDC(100), new anchor.BN(0)).accountsPartial(A).rpc());
  await retry(() => program.methods.markRealized(USDC(1000)).accountsPartial(A).rpc());
  await retry(() => mintTo(connection, admin, TEST_USDC, vaultUsdc, admin, 1000 * 1e6)); // broker returns the full 1,000 (flat)
  await retry(() => program.methods.settle(USDC(1000)).accountsPartial({ vault, vaultUsdc, admin: admin.publicKey }).rpc());
  const v2 = await retry(() => program.account.vault.fetch(vault));
  ok(`deal ran flat → Claimable · redeemable ${ui(v2.redeemableAmount.toNumber())} across ${ui(v2.totalShares.toNumber())} tokens (full gross, fee not yet taken)`);

  // ---- Dave redeems 1,000 tokens → expect ~950 (5% off the redemption) ----
  const before = ui((await retry(() => getAccount(connection, daveUsdc.address))).amount);
  await retry(() => program.methods.claim(USDC(1000)).accountsPartial({
    vault, buyerState, shareMint, vaultUsdc, claimantShares: daveShares.address, claimantUsdc: daveUsdc.address, claimant: dave.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([dave]).rpc());
  const after = ui((await retry(() => getAccount(connection, daveUsdc.address))).amount);
  const received = after - before;
  const v3 = await program.account.vault.fetch(vault);
  const supply = (await connection.getTokenSupply(shareMint)).value.uiAmount!;

  if (received !== 950) bad(`expected 950 USDC net (5% exit fee), got ${received}`);
  if (ui(v3.feesCollected.toNumber()) !== 50) bad(`expected 50 fees collected, got ${ui(v3.feesCollected.toNumber())}`);
  if (supply !== 0) bad(`expected 0 supply after full redemption, got ${supply}`);
  ok(`redeem 1,000 tokens → ${received} USDC (5% = 50 taken at exit · fees_collected ${ui(v3.feesCollected.toNumber())} awaits sweep)`);

  console.log(`\n✓ Exit-fee model: $1,000 in → 1,000 tokens → $950 out. Vault ${vault.toBase58()}\n`);

  fs.writeFileSync(`${__dirname}/devnet-exit-fee.json`, JSON.stringify({
    cluster: connection.rpcEndpoint, vaultId: VAULT_ID, vault: vault.toBase58(), shareMint: shareMint.toBase58(),
    model: "exit-fee", depositedTokens: tokens, redeemedNet: received, feeCollected: ui(v3.feesCollected.toNumber()),
  }, null, 2));
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
