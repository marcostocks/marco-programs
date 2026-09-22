/**
 * Live REDEMPTION demo on devnet — a vault's whole life, ending in a burn.
 *
 * A fresh vault is created and a fresh depositor (Dave) subscribes 1,000 USDC
 * for 950 claim tokens. The operator then drives the deal end-to-end — seal,
 * source, deploy capital to the broker, list, realize — the position gains 20%,
 * and net proceeds are wired back. At settle the vault becomes Claimable, and
 * Dave redeems:
 *   claim — his 950 claim tokens are BURNED and he receives pro-rata USDC.
 *
 * Proceeds are minted into the vault to simulate the broker's return wire.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/demo-redeem-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAccount, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

const TEST_USDC = new PublicKey("C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef");
const VAULT_ID = "HK-IPO-DEMO-003";
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
const DAY = 86400;
const ui = (n: bigint | number) => Number(n) / 1e6;

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

  if (await connection.getAccountInfo(vault)) { console.error(`vault ${VAULT_ID} already exists — pick a new id`); process.exit(1); }

  // ---- create the vault ----
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
  console.log("vault created :", vault.toBase58(), `(${VAULT_ID})`);

  // ---- Dave subscribes ----
  const dave = Keypair.generate();
  console.log("depositor     :", dave.publicKey.toBase58(), "(Dave)");
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: dave.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })));
  const daveUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, TEST_USDC, dave.publicKey);
  await mintTo(connection, admin, TEST_USDC, daveUsdc.address, admin, 2_000 * 1e6);
  const daveShares = await getOrCreateAssociatedTokenAccount(connection, admin, shareMint, dave.publicKey);
  const [buyerState] = PublicKey.findProgramAddressSync([Buffer.from("buyer"), vault.toBuffer(), dave.publicKey.toBuffer()], program.programId);

  await program.methods.openFunding().accountsPartial({ vault, admin: admin.publicKey }).rpc();
  const depositTx = await program.methods.deposit(USDC(1000)).accountsPartial({
    vault, buyerState, shareMint, depositorUsdc: daveUsdc.address, vaultUsdc, depositorShares: daveShares.address, depositor: dave.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).signers([dave]).rpc();
  console.log("deposit tx:", depositTx);
  console.log(`Dave deposited 1,000 → holds ${ui((await getAccount(connection, daveShares.address)).amount)} claim tokens (frozen)\n`);

  // ---- operator drives the deal ----
  const A = { vault, admin: admin.publicKey };
  await program.methods.sealFunding().accountsPartial(A).rpc();
  await program.methods.beginSourcing().accountsPartial(A).rpc();
  await program.methods.confirmAllocation(USDC(950)).accountsPartial(A).rpc();
  await program.methods.deployCapital(USDC(950)).accountsPartial({ vault, vaultUsdc, destination: brokerUsdc, adminOrOperator: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  await program.methods.markListed(USDC(100), new anchor.BN(0)).accountsPartial(A).rpc();
  await program.methods.markRealized(USDC(1200)).accountsPartial(A).rpc();
  console.log("operator drove: Funding → Sealed → Sourcing → Sourced → Deployed → Live → Realized");
  console.log(`  ${ui((await getAccount(connection, brokerUsdc)).amount)} USDC deployed to broker · vault holds ${ui((await getAccount(connection, vaultUsdc)).amount)} (the 5% fee)`);

  // ---- broker wires net proceeds back (20% gain): mint into the vault ----
  const NET = 1140; // 950 deployed → +20%
  await mintTo(connection, admin, TEST_USDC, vaultUsdc, admin, NET * 1e6);

  // ---- settle → Claimable ----
  await program.methods.settle(USDC(NET)).accountsPartial({ vault, vaultUsdc, admin: admin.publicKey }).rpc();
  const vAfterSettle = await program.account.vault.fetch(vault);
  console.log(`\nsettle: phase → ${Object.keys(vAfterSettle.phase)[0]} · redeemable ${ui(vAfterSettle.redeemableAmount.toNumber())} across ${ui(vAfterSettle.totalShares.toNumber())} claim tokens`);

  // ---- THE REDEMPTION ----
  const daveUsdcBefore = ui((await getAccount(connection, daveUsdc.address)).amount);
  const supplyBefore = (await connection.getTokenSupply(shareMint)).value.uiAmount!;
  const sig = await program.methods.claim(USDC(950)).accountsPartial({
    vault, buyerState, shareMint, vaultUsdc, claimantShares: daveShares.address, claimantUsdc: daveUsdc.address, claimant: dave.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([dave]).rpc();
  console.log("\nclaim tx:", sig);

  const daveUsdcAfter = ui((await getAccount(connection, daveUsdc.address)).amount);
  const daveSharesAfter = ui((await getAccount(connection, daveShares.address)).amount);
  const supplyAfter = (await connection.getTokenSupply(shareMint)).value.uiAmount!;

  console.log("\n=== Redemption (burn → proceeds) ===");
  console.log(`Dave claim tokens : ${ui(950 * 1e6)} → ${daveSharesAfter}  (burned)`);
  console.log(`claim-mint supply : ${supplyBefore} → ${supplyAfter}  (−${supplyBefore - supplyAfter})`);
  console.log(`Dave USDC         : ${daveUsdcBefore} → ${daveUsdcAfter}  (+${(daveUsdcAfter - daveUsdcBefore).toFixed(2)})`);
  console.log(`  deposited 1,000 → redeemed ${(daveUsdcAfter - daveUsdcBefore).toFixed(2)}  (net +${(daveUsdcAfter - daveUsdcBefore - 1000).toFixed(2)} after the 5% entry fee)`);

  fs.writeFileSync(`${__dirname}/devnet-vault2.json`, JSON.stringify({
    cluster: connection.rpcEndpoint, programId: program.programId.toBase58(), vaultId: VAULT_ID,
    vault: vault.toBase58(), shareMint: shareMint.toBase58(), vaultUsdc, depositDestination: brokerUsdc.toBase58(), usdcMint: TEST_USDC.toBase58(),
    depositor: dave.publicKey.toBase58(), depositTx, claimTx: sig,
  }, null, 2));
  console.log("\nwrote scripts/devnet-vault2.json");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
