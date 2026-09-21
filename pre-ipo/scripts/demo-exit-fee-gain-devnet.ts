/**
 * Prove the exit fee is charged on the REDEMPTION VALUE, so it scales with the
 * outcome — the case where the two possible bases diverge.
 *
 * Vault gains 20%:
 *   deposit 1,000 → 1,000 tokens
 *   redeem  1,000 tokens → gross 1,200, fee 60 (5% of the 1,200 withdrawn)
 *                        → 1,140 net
 * A flat-on-subscription basis would have charged 50 and paid 1,150. Charging
 * on the redemption means the protocol shares the outcome rather than taking a
 * fixed amount regardless of it.
 *
 *   npx ts-node scripts/demo-exit-fee-gain-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAccount, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

process.on("unhandledRejection", (r) => console.log(`   … survived RPC rejection: ${(r as Error)?.message?.slice(0, 70)}`));

const TEST_USDC = new PublicKey("C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef");
const VAULT_ID = "EXITFEE-GAIN-02";
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
const DAY = 86400;
const ui = (n: bigint | number) => Number(n) / 1e6;
const ok = (t: string) => console.log(`   ✓ ${t}`);
const bad = (t: string): never => { throw new Error(`✗ ${t}`); };

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
  if (await connection.getAccountInfo(vault)) bad(`vault ${VAULT_ID} exists — pick a new id`);

  const vaultUsdc = await createAccount(connection, admin, TEST_USDC, vault, Keypair.generate());
  const brokerUsdc = await createAccount(connection, admin, TEST_USDC, Keypair.generate().publicKey);
  const now = Math.floor(Date.now() / 1000);
  await retry(() => program.methods.initializeVault({
    vaultId: VAULT_ID, depositCap: USDC(1_000_000), minDeposit: USDC(100), maxDeposit: USDC(100_000),
    fundingStart: new anchor.BN(now), fundingDeadline: new anchor.BN(now + 30 * DAY), closeOutAt: new anchor.BN(now + 365 * DAY), feeBps: 500,
  }).accountsPartial({
    vault, shareMint, vaultUsdc, depositDestination: brokerUsdc, admin: admin.publicKey, operator: admin.publicKey, treasury: admin.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  }).rpc());
  await retry(() => program.methods.setFeeTiming(true).accountsPartial({ vault, admin: admin.publicKey }).rpc());
  await retry(() => program.methods.openFunding().accountsPartial({ vault, admin: admin.publicKey }).rpc());

  const dave = Keypair.generate();
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: dave.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })));
  const daveUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, TEST_USDC, dave.publicKey);
  await retry(() => mintTo(connection, admin, TEST_USDC, daveUsdc.address, admin, 2_000 * 1e6));
  const daveShares = await getOrCreateAssociatedTokenAccount(connection, admin, shareMint, dave.publicKey);
  const [buyerState] = PublicKey.findProgramAddressSync([Buffer.from("buyer"), vault.toBuffer(), dave.publicKey.toBuffer()], program.programId);

  await retry(() => program.methods.deposit(USDC(1000)).accountsPartial({
    vault, buyerState, shareMint, depositorUsdc: daveUsdc.address, vaultUsdc, depositorShares: daveShares.address, depositor: dave.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([dave]).rpc());
  const tokens = ui((await retry(() => getAccount(connection, daveShares.address))).amount);
  if (tokens !== 1000) bad(`expected 1,000 tokens, got ${tokens}`);
  ok(`deposit 1,000 → ${tokens} tokens (1:1 gross)`);

  // Deal gains 20%: deploy 1,000, broker returns 1,200.
  const A = { vault, admin: admin.publicKey };
  await retry(() => program.methods.sealFunding().accountsPartial(A).rpc());
  await retry(() => program.methods.beginSourcing().accountsPartial(A).rpc());
  await retry(() => program.methods.confirmAllocation(USDC(1000)).accountsPartial(A).rpc());
  await retry(() => program.methods.deployCapital(USDC(1000)).accountsPartial({ vault, vaultUsdc, destination: brokerUsdc, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc());
  await retry(() => program.methods.markListed(USDC(100), new anchor.BN(0)).accountsPartial(A).rpc());
  await retry(() => program.methods.markRealized(USDC(1200)).accountsPartial(A).rpc());
  await retry(() => mintTo(connection, admin, TEST_USDC, vaultUsdc, admin, 1200 * 1e6)); // +20%
  await retry(() => program.methods.settle(USDC(1200)).accountsPartial({ vault, vaultUsdc, admin: admin.publicKey }).rpc());
  ok(`deal gained 20% → redeemable ${ui((await retry(() => program.account.vault.fetch(vault))).redeemableAmount.toNumber())}`);

  const before = ui((await retry(() => getAccount(connection, daveUsdc.address))).amount);
  await retry(() => program.methods.claim(USDC(1000)).accountsPartial({
    vault, buyerState, shareMint, vaultUsdc, claimantShares: daveShares.address, claimantUsdc: daveUsdc.address, claimant: dave.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([dave]).rpc());
  const received = ui((await retry(() => getAccount(connection, daveUsdc.address))).amount) - before;
  const v = await retry(() => program.account.vault.fetch(vault));

  if (received !== 1140) bad(`expected 1,140 net (5% of the 1,200 redeemed), got ${received}`);
  if (ui(v.feesCollected.toNumber()) !== 60) bad(`expected fee 60, got ${ui(v.feesCollected.toNumber())}`);
  ok(`redeem 1,000 tokens on a +20% deal → ${received} USDC · fee ${ui(v.feesCollected.toNumber())} (5% of the 1,200 redeemed, NOT a flat 50)`);
  console.log(`\n✓ The exit fee is 5% of what you withdraw, so it scales with the outcome. Vault ${vault.toBase58()}\n`);
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
