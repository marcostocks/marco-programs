import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MarcoVault } from "../target/types/marco_vault";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  transferChecked,
} from "@solana/spl-token";
import { assert } from "chai";

const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));

describe("marco-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MarcoVault as Program<MarcoVault>;
  const conn = provider.connection;

  // Actors
  const admin = Keypair.generate();
  const operator = Keypair.generate();
  const treasury = Keypair.generate();
  const d1 = Keypair.generate();
  const d2 = Keypair.generate();
  const broker = Keypair.generate();

  let usdcMint: PublicKey;
  let vaultUsdc: PublicKey;
  let brokerUsdc: PublicKey; // immutable deposit_destination
  let treasuryUsdc: PublicKey;
  let d1Usdc: PublicKey, d2Usdc: PublicKey;
  let d1Shares: PublicKey, d2Shares: PublicKey;

  let vaultPda: PublicKey, shareMintPda: PublicKey;
  let buyer1: PublicKey, buyer2: PublicKey;

  const VAULT_ID = "hkex-demo-2026-q3";
  const CAP = USDC(3_000_000);
  const FEE_BPS = 500; // 5.00%

  const airdrop = async (kp: Keypair) => {
    const sig = await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig);
  };

  before(async () => {
    for (const kp of [admin, operator, treasury, d1, d2, broker]) await airdrop(kp);

    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)],
      program.programId
    );
    [shareMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), vaultPda.toBuffer()],
      program.programId
    );
    [buyer1] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyer"), vaultPda.toBuffer(), d1.publicKey.toBuffer()],
      program.programId
    );
    [buyer2] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyer"), vaultPda.toBuffer(), d2.publicKey.toBuffer()],
      program.programId
    );

    vaultUsdc = await createAccount(conn, admin, usdcMint, vaultPda, Keypair.generate());
    brokerUsdc = await createAccount(conn, admin, usdcMint, broker.publicKey);
    treasuryUsdc = await createAccount(conn, admin, usdcMint, treasury.publicKey);
    d1Usdc = await createAccount(conn, admin, usdcMint, d1.publicKey);
    d2Usdc = await createAccount(conn, admin, usdcMint, d2.publicKey);

    await mintTo(conn, admin, usdcMint, d1Usdc, admin, 2_500_000 * 1e6);
    await mintTo(conn, admin, usdcMint, d2Usdc, admin, 1_000_000 * 1e6);
  });

  const now = () => Math.floor(Date.now() / 1000);

  it("initializes a vault with an immutable broker destination", async () => {
    const params = {
      vaultId: VAULT_ID,
      depositCap: CAP,
      minDeposit: USDC(100),
      maxDeposit: USDC(2_000_000), // per-address cap
      fundingStart: new anchor.BN(now() - 10),
      fundingDeadline: new anchor.BN(now() + 86400),
      closeOutAt: new anchor.BN(now() + 86400 * 180),
      feeBps: FEE_BPS,
    };

    await program.methods
      .initializeVault(params)
      .accounts({
        vault: vaultPda,
        shareMint: shareMintPda,
        vaultUsdc,
        depositDestination: brokerUsdc,
        admin: admin.publicKey,
        operator: operator.publicKey,
        treasury: treasury.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    const v = await program.account.vault.fetch(vaultPda);
    assert.equal(v.depositDestination.toBase58(), brokerUsdc.toBase58());
    assert.equal(v.feeBps, FEE_BPS);
    assert.deepEqual(v.phase, { scheduled: {} });

    // claim-token ATAs (mint now exists)
    d1Shares = await createAccount(conn, admin, shareMintPda, d1.publicKey);
    d2Shares = await createAccount(conn, admin, shareMintPda, d2.publicKey);
  });

  it("opens funding", async () => {
    await program.methods
      .openFunding()
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
    const v = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(v.phase, { funding: {} });
  });

  it("accepts a deposit and mints 1:1", async () => {
    await program.methods
      .deposit(USDC(1_000_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyer1,
        shareMint: shareMintPda,
        depositorUsdc: d1Usdc,
        vaultUsdc,
        depositorShares: d1Shares,
        depositor: d1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([d1])
      .rpc();

    const shares = await getAccount(conn, d1Shares);
    assert.equal(shares.amount.toString(), USDC(1_000_000).toString());
    assert.isTrue(shares.isFrozen, "claim tokens must be locked on mint");
  });

  it("locks claim tokens — a holder cannot transfer them", async () => {
    let failed = false;
    try {
      await transferChecked(
        conn,
        d1,
        d1Shares,
        shareMintPda,
        d2Shares,
        d1,
        BigInt(USDC(1).toString()),
        6
      );
    } catch (_e) {
      failed = true;
    }
    assert.isTrue(failed, "transferring locked claim tokens must revert");
  });

  it("partial-fills a deposit that would exceed the per-address cap", async () => {
    // d1 max is 2,000,000 and already in for 1,000,000 -> only 1,000,000 more accepted.
    await program.methods
      .deposit(USDC(1_500_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyer1,
        shareMint: shareMintPda,
        depositorUsdc: d1Usdc,
        vaultUsdc,
        depositorShares: d1Shares,
        depositor: d1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([d1])
      .rpc();

    const b = await program.account.buyerState.fetch(buyer1);
    assert.equal(b.depositAmount.toString(), USDC(2_000_000).toString());

    // Second deposit goes through thaw -> mint -> re-freeze; it must end locked.
    const shares = await getAccount(conn, d1Shares);
    assert.equal(shares.amount.toString(), USDC(2_000_000).toString());
    assert.isTrue(shares.isFrozen, "must be re-locked after topping up");
  });

  it("fills the cap from a second depositor and auto-seals", async () => {
    // cap is 3,000,000; 2,000,000 taken -> only 1,000,000 accepted, seals.
    await program.methods
      .deposit(USDC(1_000_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyer2,
        shareMint: shareMintPda,
        depositorUsdc: d2Usdc,
        vaultUsdc,
        depositorShares: d2Shares,
        depositor: d2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([d2])
      .rpc();

    const v = await program.account.vault.fetch(vaultPda);
    assert.equal(v.totalDeposits.toString(), CAP.toString());
    assert.deepEqual(v.phase, { sealed: {} });
  });

  it("sources and confirms the full allocation", async () => {
    await program.methods
      .beginSourcing()
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    await program.methods
      .confirmAllocation(CAP)
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const v = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(v.phase, { sourced: {} });
    assert.equal(v.deployableAmount.toString(), CAP.toString());
  });

  it("rejects deployment to the wrong destination", async () => {
    const rogue = await createAccount(conn, admin, usdcMint, operator.publicKey);
    let failed = false;
    try {
      await program.methods
        .deployCapital(CAP)
        .accounts({
          vault: vaultPda,
          vaultUsdc,
          destination: rogue,
          adminOrOperator: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();
    } catch (_e) {
      failed = true;
    }
    assert.isTrue(failed, "deploy to a non-broker account must revert");
  });

  it("deploys capital to the immutable broker account", async () => {
    await program.methods
      .deployCapital(CAP)
      .accounts({
        vault: vaultPda,
        vaultUsdc,
        destination: brokerUsdc,
        adminOrOperator: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const bal = await getAccount(conn, brokerUsdc);
    assert.equal(bal.amount.toString(), CAP.toString());
  });

  it("lists, realizes, and settles with a 5% fee", async () => {
    await program.methods
      // Cash-only path: allocation recorded, election window closed (0s).
      .markListed(new anchor.BN(1_000_000), new anchor.BN(0))
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    await program.methods
      .markRealized(USDC(3_600_000))
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    // Broker returns net proceeds to the vault before settle.
    const net = USDC(3_500_000);
    await mintTo(conn, admin, usdcMint, vaultUsdc, admin, net.toNumber());

    await program.methods
      .settle(net)
      .accounts({ vault: vaultPda, vaultUsdc, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const v = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(v.phase, { claimable: {} });
    // fee = 5% of 3,500,000 = 175,000
    assert.equal(v.feesCollected.toString(), USDC(175_000).toString());
    // redeemable = balance (3,500,000) - fee (175,000) = 3,325,000
    assert.equal(v.redeemableAmount.toString(), USDC(3_325_000).toString());
  });

  it("lets a holder claim pro-rata USDC", async () => {
    const before = (await getAccount(conn, d2Usdc)).amount;
    // d2 holds 1,000,000 of 3,000,000 shares -> 1/3 of 3,325,000 = 1,108,333.33
    await program.methods
      .claim(USDC(1_000_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyer2,
        shareMint: shareMintPda,
        vaultUsdc,
        claimantShares: d2Shares,
        claimantUsdc: d2Usdc,
        claimant: d2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([d2])
      .rpc();

    const after = (await getAccount(conn, d2Usdc)).amount;
    const got = Number(after - before);
    assert.approximately(got, 1_108_333_333_333, 2, "≈ 1/3 of redeemable");

    // Fully redeemed: left thawed so the holder can close the account and
    // recover rent (a frozen SPL account cannot be closed).
    const shares = await getAccount(conn, d2Shares);
    assert.equal(shares.amount.toString(), "0");
    assert.isFalse(shares.isFrozen, "an emptied account must not stay frozen");
  });

  it("re-locks the remainder after a partial claim", async () => {
    // d1 holds 2,000,000 and redeems a quarter of it.
    await program.methods
      .claim(USDC(500_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyer1,
        shareMint: shareMintPda,
        vaultUsdc,
        claimantShares: d1Shares,
        claimantUsdc: d1Usdc,
        claimant: d1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([d1])
      .rpc();

    const shares = await getAccount(conn, d1Shares);
    assert.equal(shares.amount.toString(), USDC(1_500_000).toString());
    assert.isTrue(shares.isFrozen, "the unredeemed balance must stay locked");
  });

  it("rejects unlock_shares while the lock is still active", async () => {
    let failed = false;
    try {
      await program.methods
        .unlockShares()
        .accounts({
          vault: vaultPda,
          shareMint: shareMintPda,
          holderShares: d1Shares,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (_e) {
      failed = true;
    }
    assert.isTrue(failed, "unlocking before admin lifts the lock must revert");
  });

  it("admin lifts the lock, holders thaw, and transfer becomes possible", async () => {
    await program.methods
      .setTransferLock(false)
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    // Lifting the flag alone does not thaw: SPL freezes are per-account.
    assert.isTrue((await getAccount(conn, d1Shares)).isFrozen);

    await program.methods
      .unlockShares()
      .accounts({
        vault: vaultPda,
        shareMint: shareMintPda,
        holderShares: d1Shares,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.isFalse((await getAccount(conn, d1Shares)).isFrozen);

    // d2's account was emptied and left thawed, so it can receive.
    await transferChecked(
      conn,
      d1,
      d1Shares,
      shareMintPda,
      d2Shares,
      d1,
      BigInt(USDC(1_000).toString()),
      6
    );
    assert.equal(
      (await getAccount(conn, d2Shares)).amount.toString(),
      USDC(1_000).toString()
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Cancellation / refund path (separate vault)
// ─────────────────────────────────────────────────────────────
describe("marco-vault: cancel + refund", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MarcoVault as Program<MarcoVault>;
  const conn = provider.connection;

  const admin = Keypair.generate();
  const dep = Keypair.generate();
  const broker = Keypair.generate();
  const treasury = Keypair.generate();

  let usdcMint: PublicKey;
  let vaultUsdc: PublicKey, brokerUsdc: PublicKey, depUsdc: PublicKey, depShares: PublicKey;
  let vaultPda: PublicKey, shareMintPda: PublicKey, buyer: PublicKey;

  const VAULT_ID = "hkex-cancelled-2026";

  before(async () => {
    for (const kp of [admin, dep, broker, treasury]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig);
    }
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)],
      program.programId
    );
    [shareMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), vaultPda.toBuffer()],
      program.programId
    );
    [buyer] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyer"), vaultPda.toBuffer(), dep.publicKey.toBuffer()],
      program.programId
    );

    vaultUsdc = await createAccount(conn, admin, usdcMint, vaultPda, Keypair.generate());
    brokerUsdc = await createAccount(conn, admin, usdcMint, broker.publicKey);
    depUsdc = await createAccount(conn, admin, usdcMint, dep.publicKey);
    await mintTo(conn, admin, usdcMint, depUsdc, admin, 1_000_000 * 1e6);
  });

  const now = () => Math.floor(Date.now() / 1000);

  it("cancels a funded vault and refunds principal less costs", async () => {
    await program.methods
      .initializeVault({
        vaultId: VAULT_ID,
        depositCap: USDC(1_000_000),
        minDeposit: USDC(0),
        maxDeposit: USDC(0),
        fundingStart: new anchor.BN(now() - 10),
        fundingDeadline: new anchor.BN(now() + 86400),
        closeOutAt: new anchor.BN(now() + 86400 * 30),
        feeBps: 500,
      })
      .accounts({
        vault: vaultPda,
        shareMint: shareMintPda,
        vaultUsdc,
        depositDestination: brokerUsdc,
        admin: admin.publicKey,
        operator: admin.publicKey,
        treasury: treasury.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    depShares = await createAccount(conn, admin, shareMintPda, dep.publicKey);

    await program.methods
      .openFunding()
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    await program.methods
      .deposit(USDC(500_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyer,
        shareMint: shareMintPda,
        depositorUsdc: depUsdc,
        vaultUsdc,
        depositorShares: depShares,
        depositor: dep.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([dep])
      .rpc();

    // Cancel with 10,000 USDC disclosed unrefundable cost.
    await program.methods
      .cancelVault(USDC(10_000))
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const v = await program.account.vault.fetch(vaultPda);
    assert.deepEqual(v.phase, { cancelled: {} });

    const before = (await getAccount(conn, depUsdc)).amount;
    await program.methods
      .refund(USDC(500_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyer,
        shareMint: shareMintPda,
        vaultUsdc,
        holderShares: depShares,
        holderUsdc: depUsdc,
        holder: dep.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([dep])
      .rpc();

    const after = (await getAccount(conn, depUsdc)).amount;
    // sole depositor: refund = 500,000 - 10,000 = 490,000
    assert.equal(Number(after - before), 490_000 * 1e6);
  });
});

// ─────────────────────────────────────────────────────────────
// Share-delivery election path (separate vault)
//
// At listing a holder can convert claim tokens into a real stock spot
// position instead of redeeming cash: they pay the protocol fee in USDC,
// their tokens are burned, and the vault records the underlying-share
// entitlement for off-chain broker settlement. The remaining (cash) holders
// then redeem over the reduced cohort, undiluted.
// ─────────────────────────────────────────────────────────────
describe("marco-vault: share-delivery election", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MarcoVault as Program<MarcoVault>;
  const conn = provider.connection;

  const admin = Keypair.generate();
  const broker = Keypair.generate();
  const treasury = Keypair.generate();
  const dA = Keypair.generate(); // elects share delivery
  const dB = Keypair.generate(); // stays cash

  let usdcMint: PublicKey;
  let vaultUsdc: PublicKey, brokerUsdc: PublicKey;
  let dAUsdc: PublicKey, dBUsdc: PublicKey, dAShares: PublicKey, dBShares: PublicKey;
  let vaultPda: PublicKey, shareMintPda: PublicKey, buyerA: PublicKey, buyerB: PublicKey;

  const VAULT_ID = "hkex-delivery-2026";
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const now = () => Math.floor(Date.now() / 1000);

  before(async () => {
    for (const kp of [admin, broker, treasury, dA, dB]) {
      const sig = await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig);
    }
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)],
      program.programId
    );
    [shareMintPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), vaultPda.toBuffer()],
      program.programId
    );
    [buyerA] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyer"), vaultPda.toBuffer(), dA.publicKey.toBuffer()],
      program.programId
    );
    [buyerB] = PublicKey.findProgramAddressSync(
      [Buffer.from("buyer"), vaultPda.toBuffer(), dB.publicKey.toBuffer()],
      program.programId
    );

    vaultUsdc = await createAccount(conn, admin, usdcMint, vaultPda, Keypair.generate());
    brokerUsdc = await createAccount(conn, admin, usdcMint, broker.publicKey);
    // dA needs principal (600k) + delivery fee (30k); dB needs principal (400k).
    dAUsdc = await createAccount(conn, admin, usdcMint, dA.publicKey);
    dBUsdc = await createAccount(conn, admin, usdcMint, dB.publicKey);
    await mintTo(conn, admin, usdcMint, dAUsdc, admin, 700_000 * 1e6);
    await mintTo(conn, admin, usdcMint, dBUsdc, admin, 400_000 * 1e6);
  });

  it("runs the full lifecycle, one holder taking shares and one taking cash", async () => {
    // Create + open a 1,000,000-cap vault, 5% fee.
    await program.methods
      .initializeVault({
        vaultId: VAULT_ID,
        depositCap: USDC(1_000_000),
        minDeposit: USDC(0),
        maxDeposit: USDC(0),
        fundingStart: new anchor.BN(now() - 10),
        fundingDeadline: new anchor.BN(now() + 86400),
        closeOutAt: new anchor.BN(now() + 86400 * 30),
        feeBps: 500,
      })
      .accounts({
        vault: vaultPda,
        shareMint: shareMintPda,
        vaultUsdc,
        depositDestination: brokerUsdc,
        admin: admin.publicKey,
        operator: admin.publicKey,
        treasury: treasury.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    dAShares = await createAccount(conn, admin, shareMintPda, dA.publicKey);
    dBShares = await createAccount(conn, admin, shareMintPda, dB.publicKey);

    await program.methods
      .openFunding()
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    // dA subscribes 600,000; dB subscribes 400,000 -> fills cap, auto-seals.
    const deposit = async (dep: Keypair, buyer: PublicKey, usdc: PublicKey, shares: PublicKey, amt: anchor.BN) =>
      program.methods
        .deposit(amt)
        .accounts({
          vault: vaultPda,
          buyerState: buyer,
          shareMint: shareMintPda,
          depositorUsdc: usdc,
          vaultUsdc,
          depositorShares: shares,
          depositor: dep.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([dep])
        .rpc();

    await deposit(dA, buyerA, dAUsdc, dAShares, USDC(600_000));
    await deposit(dB, buyerB, dBUsdc, dBShares, USDC(400_000));

    // Source, confirm full allocation, deploy to the broker.
    await program.methods.beginSourcing().accounts({ vault: vaultPda, admin: admin.publicKey }).signers([admin]).rpc();
    await program.methods
      .confirmAllocation(USDC(1_000_000))
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
    await program.methods
      .deployCapital(USDC(1_000_000))
      .accounts({
        vault: vaultPda,
        vaultUsdc,
        destination: brokerUsdc,
        adminOrOperator: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    // List: broker holds 500,000 real shares for 1,000,000 tokens
    // (0.5 share per token), election window open ~3s.
    await program.methods
      .markListed(new anchor.BN(500_000), new anchor.BN(3))
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    // dA elects delivery of all 600,000 tokens.
    const dAUsdcBefore = (await getAccount(conn, dAUsdc)).amount;
    await program.methods
      .electDelivery(USDC(600_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyerA,
        shareMint: shareMintPda,
        vaultUsdc,
        holderShares: dAShares,
        holderUsdc: dAUsdc,
        holder: dA.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([dA])
      .rpc();

    // Tokens burned, fee (5% of 600,000 = 30,000) paid, entitlement recorded.
    assert.equal((await getAccount(conn, dAShares)).amount.toString(), "0");
    assert.equal(
      Number(dAUsdcBefore - (await getAccount(conn, dAUsdc)).amount),
      30_000 * 1e6,
      "dA paid the 30,000 USDC delivery fee"
    );
    const ba = await program.account.buyerState.fetch(buyerA);
    assert.equal(ba.sharesDelivered.toString(), USDC(600_000).toString());
    assert.equal(ba.underlyingDelivered.toString(), "300000", "0.5 share/token * 600,000 = 300,000 shares");
    assert.equal(ba.deliveryFeePaid.toString(), USDC(30_000).toString());

    const vLive = await program.account.vault.fetch(vaultPda);
    assert.equal(vLive.deliveredShares.toString(), USDC(600_000).toString());
    assert.equal(vLive.feesCollected.toString(), USDC(30_000).toString());

    // Wait for the election window to close, then realize + settle.
    await sleep(3500);

    // Broker sells the cash cohort (dB's 40%) and wires 440,000 net back.
    await mintTo(conn, admin, usdcMint, vaultUsdc, admin, 440_000 * 1e6);
    await program.methods
      .markRealized(USDC(460_000))
      .accounts({ vault: vaultPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
    await program.methods
      .settle(USDC(440_000))
      .accounts({ vault: vaultPda, vaultUsdc, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    const vSettled = await program.account.vault.fetch(vaultPda);
    // fees = 30,000 (delivery) + 5% of 440,000 (22,000) = 52,000
    assert.equal(vSettled.feesCollected.toString(), USDC(52_000).toString());
    // redeemable = balance (30,000 fee + 440,000 net) - 52,000 = 418,000
    assert.equal(vSettled.redeemableAmount.toString(), USDC(418_000).toString());

    // dB (the entire cash cohort of 400,000 tokens) claims the whole pool.
    const dBBefore = (await getAccount(conn, dBUsdc)).amount;
    await program.methods
      .claim(USDC(400_000))
      .accounts({
        vault: vaultPda,
        buyerState: buyerB,
        shareMint: shareMintPda,
        vaultUsdc,
        claimantShares: dBShares,
        claimantUsdc: dBUsdc,
        claimant: dB.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([dB])
      .rpc();

    const dBGot = Number((await getAccount(conn, dBUsdc)).amount - dBBefore);
    // Cash cohort gets net minus the settlement fee: 440,000 - 22,000 = 418,000.
    assert.approximately(dBGot, 418_000 * 1e6, 2, "cash cohort redeems the full pool");
  });
});
