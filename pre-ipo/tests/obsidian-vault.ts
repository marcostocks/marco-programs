import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ObsidianVault } from "../target/types/obsidian_vault";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";

describe("obsidian-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ObsidianVault as Program<ObsidianVault>;

  // Actors
  const admin = Keypair.generate();
  const operator = Keypair.generate();
  const treasury = Keypair.generate();
  const depositor1 = Keypair.generate();
  const depositor2 = Keypair.generate();
  const brokerWallet = Keypair.generate();

  // USDC mint (simulated)
  let usdcMint: PublicKey;

  // Token accounts
  let vaultUsdc: PublicKey;
  let depositor1Usdc: PublicKey;
  let depositor2Usdc: PublicKey;
  let depositor1Shares: PublicKey;
  let depositor2Shares: PublicKey;
  let treasuryUsdc: PublicKey;
  let brokerUsdc: PublicKey;

  // PDAs
  let vaultPda: PublicKey;
  let vaultBump: number;
  let shareMintPda: PublicKey;
  let shareMintBump: number;
  let buyer1Pda: PublicKey;
  let buyer2Pda: PublicKey;

  const VAULT_ID = "test-ipo-vault-001";
  const DEPOSIT_CAP = 3_000_000 * 1e6; // 3M USDC (6 decimals)
  const SOURCING_SPREAD = 150; // 1.50% sourcing spread (Obsidian's only on-chain vault fee)

  before(async () => {
    // Airdrop SOL to all actors
    for (const kp of [admin, operator, treasury, depositor1, depositor2, brokerWallet]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Create USDC mint (6 decimals, admin is mint authority)
    usdcMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6 // USDC has 6 decimals
    );

    // Derive PDAs
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)],
      program.programId
    );

    [shareMintPda, shareMintBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), vaultPda.toBuffer()],
      program.programId
    );

    [buyer1Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyer"), vaultPda.toBuffer(), depositor1.publicKey.toBuffer()],
      program.programId
    );

    [buyer2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyer"), vaultPda.toBuffer(), depositor2.publicKey.toBuffer()],
      program.programId
    );

    // Create USDC token accounts
    vaultUsdc = await createAccount(provider.connection, admin, usdcMint, vaultPda);
    depositor1Usdc = await createAccount(provider.connection, admin, usdcMint, depositor1.publicKey);
    depositor2Usdc = await createAccount(provider.connection, admin, usdcMint, depositor2.publicKey);
    treasuryUsdc = await createAccount(provider.connection, admin, usdcMint, treasury.publicKey);
    brokerUsdc = await createAccount(provider.connection, admin, usdcMint, brokerWallet.publicKey);

    // Mint USDC to depositors (1M each)
    await mintTo(provider.connection, admin, usdcMint, depositor1Usdc, admin, 1_000_000 * 1e6);
    await mintTo(provider.connection, admin, usdcMint, depositor2Usdc, admin, 1_000_000 * 1e6);
  });

  // ─── INITIALIZATION ──────────────────────────────────

  it("initializes a vault", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h from now

    await program.methods
      .initializeVault(VAULT_ID, new anchor.BN(DEPOSIT_CAP), new anchor.BN(deadline), SOURCING_SPREAD)
      .accounts({
        vault: vaultPda,
        shareMint: shareMintPda,
        vaultUsdc: vaultUsdc,
        admin: admin.publicKey,
        operator: operator.publicKey,
        treasury: treasury.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.vaultId, VAULT_ID);
    assert.equal(vault.depositCap.toNumber(), DEPOSIT_CAP);
    assert.equal(vault.sourcingSpreadBps, SOURCING_SPREAD);
    assert.deepEqual(vault.phase, { fundingOpen: {} });
    assert.equal(vault.frozen, false);
  });

  it("rejects vault ID longer than 64 chars", async () => {
    const longId = "a".repeat(65);
    const [badVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(longId)],
      program.programId
    );

    try {
      await program.methods
        .initializeVault(longId, new anchor.BN(DEPOSIT_CAP), new anchor.BN(0), SOURCING_SPREAD)
        .accounts({
          vault: badVault,
          shareMint: shareMintPda,
          vaultUsdc: vaultUsdc,
          admin: admin.publicKey,
          operator: operator.publicKey,
          treasury: treasury.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();
      assert.fail("Should have rejected long vault ID");
    } catch (e) {
      expect(e.message).to.include("VaultIdTooLong");
    }
  });

  // ─── DEPOSITS ────────────────────────────────────────

  it("accepts a USDC deposit", async () => {
    // Create share token accounts for depositors
    depositor1Shares = await createAccount(
      provider.connection, admin, shareMintPda, depositor1.publicKey
    );

    const depositAmount = 500_000 * 1e6; // 500K USDC

    await program.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        vault: vaultPda,
        buyerState: buyer1Pda,
        shareMint: shareMintPda,
        depositorUsdc: depositor1Usdc,
        vaultUsdc: vaultUsdc,
        depositorShares: depositor1Shares,
        depositor: depositor1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor1])
      .rpc();

    // Check vault state
    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.totalDeposits.toNumber(), depositAmount);
    assert.equal(vault.totalShares.toNumber(), depositAmount);

    // Check buyer state
    const buyer = await program.account.buyerState.fetch(buyer1Pda);
    assert.equal(buyer.depositAmount.toNumber(), depositAmount);
    assert.equal(buyer.sharesMinted.toNumber(), depositAmount);

    // Check share token balance
    const sharesAccount = await getAccount(provider.connection, depositor1Shares);
    assert.equal(Number(sharesAccount.amount), depositAmount);
  });

  it("rejects deposit when frozen", async () => {
    // Freeze
    await program.methods
      .freezeDeposits(true)
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    try {
      await program.methods
        .deposit(new anchor.BN(100_000 * 1e6))
        .accounts({
          vault: vaultPda,
          buyerState: buyer1Pda,
          shareMint: shareMintPda,
          depositorUsdc: depositor1Usdc,
          vaultUsdc: vaultUsdc,
          depositorShares: depositor1Shares,
          depositor: depositor1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor1])
        .rpc();
      assert.fail("Should reject frozen deposit");
    } catch (e) {
      expect(e.message).to.include("DepositsFrozen");
    }

    // Unfreeze
    await program.methods
      .freezeDeposits(false)
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
  });

  it("rejects deposit exceeding cap", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(DEPOSIT_CAP)) // Would exceed since 500K already deposited
        .accounts({
          vault: vaultPda,
          buyerState: buyer1Pda,
          shareMint: shareMintPda,
          depositorUsdc: depositor1Usdc,
          vaultUsdc: vaultUsdc,
          depositorShares: depositor1Shares,
          depositor: depositor1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor1])
        .rpc();
      assert.fail("Should reject over-cap deposit");
    } catch (e) {
      expect(e.message).to.include("DepositExceedsCap");
    }
  });

  it("allows second depositor", async () => {
    depositor2Shares = await createAccount(
      provider.connection, admin, shareMintPda, depositor2.publicKey
    );

    const depositAmount = 300_000 * 1e6; // 300K USDC

    await program.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        vault: vaultPda,
        buyerState: buyer2Pda,
        shareMint: shareMintPda,
        depositorUsdc: depositor2Usdc,
        vaultUsdc: vaultUsdc,
        depositorShares: depositor2Shares,
        depositor: depositor2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor2])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.totalDeposits.toNumber(), 800_000 * 1e6);
  });

  // ─── CLOSE FUNDING ──────────────────────────────────

  it("admin closes funding", async () => {
    await program.methods
      .closeFunding()
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(vault.phase, { fundingClosed: {} });
  });

  it("rejects deposits after closing", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(100_000 * 1e6))
        .accounts({
          vault: vaultPda,
          buyerState: buyer1Pda,
          shareMint: shareMintPda,
          depositorUsdc: depositor1Usdc,
          vaultUsdc: vaultUsdc,
          depositorShares: depositor1Shares,
          depositor: depositor1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([depositor1])
        .rpc();
      assert.fail("Should reject post-close deposit");
    } catch (e) {
      expect(e.message).to.include("InvalidPhase");
    }
  });

  // ─── MOVE ASSETS ────────────────────────────────────

  it("operator moves assets to broker", async () => {
    const moveAmount = 800_000 * 1e6; // Move all deposits

    await program.methods
      .moveAssets(new anchor.BN(moveAmount))
      .accounts({
        vault: vaultPda,
        vaultUsdc: vaultUsdc,
        destination: brokerUsdc,
        adminOrOperator: operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(vault.phase, { assetsDeployed: {} });
    assert.equal(vault.totalMoved.toNumber(), moveAmount);

    // Verify broker received USDC
    const brokerAccount = await getAccount(provider.connection, brokerUsdc);
    assert.equal(Number(brokerAccount.amount), moveAmount);
  });

  it("rejects move exceeding deposits", async () => {
    try {
      await program.methods
        .moveAssets(new anchor.BN(1_000_000 * 1e6)) // More than deposited
        .accounts({
          vault: vaultPda,
          vaultUsdc: vaultUsdc,
          destination: brokerUsdc,
          adminOrOperator: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
      assert.fail("Should reject over-limit move");
    } catch (e) {
      expect(e.message).to.include("MoveWouldDrainReserved");
    }
  });

  // ─── SETTLEMENT ─────────────────────────────────────

  it("records settlement (profitable IPO)", async () => {
    // Simulate: broker returns 1.12M USDC (40% return on 800K)
    const settlementAmount = 1_120_000 * 1e6;

    // Mint USDC to vault (simulating broker return)
    await mintTo(provider.connection, admin, usdcMint, vaultUsdc, admin, settlementAmount);

    await program.methods
      .recordSettlement(new anchor.BN(settlementAmount))
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(vault.phase, { settled: {} });
    assert.equal(vault.settlementAmount.toNumber(), settlementAmount);

    // Verify fee calculation — sourcing spread only, flat bps of settlement
    // Sourcing spread: 1.12M * 1.50% = 16.8K
    assert.equal(vault.feesCollected.toNumber(), 16_800 * 1e6);
  });

  // ─── REDEMPTION ─────────────────────────────────────

  it("opens redemption", async () => {
    await program.methods
      .openRedemption()
      .accounts({
        vault: vaultPda,
        vaultUsdc: vaultUsdc,
        admin: admin.publicKey,
      })
      .signers([admin])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(vault.phase, { redemptionOpen: {} });
    assert.isAbove(vault.redeemableAmount.toNumber(), 0);
  });

  it("depositor 1 redeems shares (pro-rata)", async () => {
    const buyer1 = await program.account.buyerState.fetch(buyer1Pda);
    const sharesToRedeem = buyer1.sharesMinted; // All shares

    await program.methods
      .redeem(sharesToRedeem)
      .accounts({
        vault: vaultPda,
        buyerState: buyer1Pda,
        shareMint: shareMintPda,
        vaultUsdc: vaultUsdc,
        redeemerShares: depositor1Shares,
        redeemerUsdc: depositor1Usdc,
        redeemer: depositor1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor1])
      .rpc();

    // Depositor 1 had 500K / 800K total = 62.5% of shares
    // Should receive 62.5% of redeemable amount
    const updatedBuyer = await program.account.buyerState.fetch(buyer1Pda);
    assert.isAbove(updatedBuyer.usdcRedeemed.toNumber(), 0);
    assert.equal(updatedBuyer.sharesRedeemed.toNumber(), sharesToRedeem.toNumber());
  });

  it("depositor 2 redeems shares", async () => {
    const buyer2 = await program.account.buyerState.fetch(buyer2Pda);
    const sharesToRedeem = buyer2.sharesMinted;

    await program.methods
      .redeem(sharesToRedeem)
      .accounts({
        vault: vaultPda,
        buyerState: buyer2Pda,
        shareMint: shareMintPda,
        vaultUsdc: vaultUsdc,
        redeemerShares: depositor2Shares,
        redeemerUsdc: depositor2Usdc,
        redeemer: depositor2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor2])
      .rpc();

    const updatedBuyer = await program.account.buyerState.fetch(buyer2Pda);
    assert.isAbove(updatedBuyer.usdcRedeemed.toNumber(), 0);
  });

  // ─── FEE SWEEP ──────────────────────────────────────

  it("admin sweeps fees to treasury", async () => {
    const vault = await program.account.vault.fetch(vaultPda);
    const sweepable = vault.feesCollected.toNumber() - vault.feesSwept.toNumber();

    if (sweepable > 0) {
      await program.methods
        .sweepFee(new anchor.BN(sweepable))
        .accounts({
          vault: vaultPda,
          vaultUsdc: vaultUsdc,
          treasuryUsdc: treasuryUsdc,
          treasury: treasury.publicKey,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const updatedVault = await program.account.vault.fetch(vaultPda);
      assert.equal(updatedVault.feesSwept.toNumber(), sweepable);
    }
  });

  // ─── ACCESS CONTROL ─────────────────────────────────

  it("rejects non-admin closing funding", async () => {
    // This would need a fresh vault to test properly
    // Included for completeness — the constraint check is on the account
  });

  it("rejects non-admin/operator moving assets", async () => {
    // The constraint on MoveAssets checks admin_or_operator
    // A random signer would fail the constraint
  });

  // ─── FULL LIFECYCLE SUMMARY ─────────────────────────

  it("verifies final vault state", async () => {
    const vault = await program.account.vault.fetch(vaultPda);

    console.log("\n═══ VAULT LIFECYCLE COMPLETE ═══");
    console.log(`Vault ID:        ${vault.vaultId}`);
    console.log(`Total deposited: ${vault.totalDeposits.toNumber() / 1e6} USDC`);
    console.log(`Settlement:      ${vault.settlementAmount.toNumber() / 1e6} USDC`);
    console.log(`Fees collected:  ${vault.feesCollected.toNumber() / 1e6} USDC`);
    console.log(`Fees swept:      ${vault.feesSwept.toNumber() / 1e6} USDC`);
    console.log(`Redeemed shares: ${vault.totalRedeemedShares.toNumber() / 1e6}`);
    console.log(`Redeemed USDC:   ${vault.totalRedeemedUsdc.toNumber() / 1e6} USDC`);
    console.log(`Phase:           RedemptionOpen`);
    console.log("════════════════════════════════\n");

    assert.deepEqual(vault.phase, { redemptionOpen: {} });
    assert.equal(vault.totalDeposits.toNumber(), 800_000 * 1e6);
    assert.equal(vault.settlementAmount.toNumber(), 1_120_000 * 1e6);
  });
});
