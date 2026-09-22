/**
 * Stand up ONE live marco-vault on devnet, end to end.
 *
 * Creates the vault's USDC token account (owned by the vault PDA), derives the
 * share-mint PDA, and calls initialize_vault on the deployed program. Reuses
 * the shared Marco devnet test-USDC mint (created by the spot market script),
 * so one USDC exists across both programs. Writes addresses to
 * scripts/devnet-vault.json.
 *
 * Run:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/init-vault-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import idl from "../target/idl/marco_vault.json";
import type { MarcoVault } from "../target/types/marco_vault";

// Shared Marco devnet test USDC (6dp, our wallet holds mint authority).
// Created by spotstocks/scripts/init-market-devnet.ts.
const TEST_USDC = new PublicKey("C7e4CPxXm6u5W1hahkPR1TmHfMdjtVwKxhurYoMFG9ef");

const VAULT_ID = "HK-IPO-DEMO-001";
const FEE_BPS = 500; // 5% flat protocol fee, taken at settlement
const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
const DAY = 24 * 60 * 60;

function loadWallet(): Keypair {
  const path = (process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`)
    .replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
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
  const program = new Program<MarcoVault>(idl as MarcoVault, provider);
  const admin = wallet; // admin == operator == treasury for a single-operator devnet vault

  console.log("cluster :", connection.rpcEndpoint);
  console.log("program :", program.programId.toBase58());
  console.log("admin   :", admin.publicKey.toBase58());
  console.log("balance :", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");
  console.log("USDC    :", TEST_USDC.toBase58());

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)],
    program.programId
  );
  const [shareMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), vaultPda.toBuffer()],
    program.programId
  );

  const existing = await connection.getAccountInfo(vaultPda);
  if (existing) {
    console.log("\nvault PDA already exists:", vaultPda.toBase58(), "— fetching state.");
    const v = await program.account.vault.fetch(vaultPda);
    console.log("phase:", Object.keys(v.phase)[0], "| cap:", v.depositCap.toString());
    return;
  }

  // vault_usdc: a token account owned by the vault PDA (program stores its key
  // at init and key-matches it on every deposit). Not an ATA — a plain account
  // with a generated address, owner = vault PDA, matching the test.
  const vaultUsdc = await createAccount(
    connection, admin, TEST_USDC, vaultPda, Keypair.generate()
  );
  console.log("\nvaultUsdc     :", vaultUsdc.toBase58(), "(owner = vault PDA)");

  // deposit_destination: the IMMUTABLE broker/SPV USDC account. Only its key is
  // stored; capital can only ever be deployed here.
  const broker = Keypair.generate();
  const brokerUsdc = await createAccount(connection, admin, TEST_USDC, broker.publicKey);
  console.log("brokerUsdc    :", brokerUsdc.toBase58(), "(deposit destination — immutable)");

  const now = Math.floor(Date.now() / 1000);
  const sig = await program.methods
    .initializeVault({
      vaultId: VAULT_ID,
      depositCap: USDC(1_000_000),
      minDeposit: USDC(100),
      maxDeposit: USDC(100_000),
      fundingStart: new anchor.BN(now),
      fundingDeadline: new anchor.BN(now + 30 * DAY),
      closeOutAt: new anchor.BN(now + 365 * DAY),
      feeBps: FEE_BPS,
    })
    .accountsPartial({
      vault: vaultPda,
      shareMint,
      vaultUsdc,
      depositDestination: brokerUsdc,
      admin: admin.publicKey,
      operator: admin.publicKey,
      treasury: admin.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("\ninitialize_vault tx:", sig);

  const v = await program.account.vault.fetch(vaultPda);
  console.log("\n=== Vault on devnet ===");
  console.log("vault_id      :", v.vaultId);
  console.log("phase         :", Object.keys(v.phase)[0]);
  console.log("deposit_cap   :", v.depositCap.toString(), "(", v.depositCap.toNumber() / 1e6, "USDC )");
  console.log("fee_bps       :", v.feeBps);
  console.log("transfer_lock :", v.transferLock);
  console.log("share_mint    :", v.shareMint.toBase58());
  console.log("deposit_dest  :", v.depositDestination.toBase58());

  const out = {
    cluster: connection.rpcEndpoint,
    programId: program.programId.toBase58(),
    vaultId: VAULT_ID,
    vault: vaultPda.toBase58(),
    shareMint: shareMint.toBase58(),
    vaultUsdc: vaultUsdc.toBase58(),
    depositDestination: brokerUsdc.toBase58(),
    usdcMint: TEST_USDC.toBase58(),
    admin: admin.publicKey.toBase58(),
    initTx: sig,
  };
  fs.writeFileSync(`${__dirname}/devnet-vault.json`, JSON.stringify(out, null, 2));
  console.log("\nwrote scripts/devnet-vault.json");
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); }
);
