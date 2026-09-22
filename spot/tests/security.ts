import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MarcoSpot } from "../target/types/marco_spot";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

// Regression tests for two confirmed vulnerabilities. Both began as working
// proof-of-concept exploits against the original code; they now assert that
// the exploit is refused, and with the specific error, so a future change
// that reopens either hole fails here.

async function expectError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e: any) {
    const got = e?.error?.errorCode?.code ?? e?.message ?? String(e);
    assert.include(String(got), code, `expected "${code}", got: ${got}`);
    return;
  }
  assert.fail(`expected "${code}" but the call succeeded`);
}

const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
const SHARES = (n: number) => new anchor.BN(Math.round(n * 1e6));
const PRICE = (n: number) => new anchor.BN(Math.round(n * 1e6));
const CUSTODY_REF = Buffer.alloc(32, 7);
const DOC_HASH = Buffer.alloc(32, 9);

describe("marco-spot: security", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MarcoSpot as Program<MarcoSpot>;
  const conn = provider.connection;

  const admin = Keypair.generate();
  const partner = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();

  let usdcMint: PublicKey;
  let marketPda: PublicKey, positionMint: PublicKey;
  let marketUsdc: PublicKey, positionEscrow: PublicKey;
  let partnerUsdc: PublicKey;
  let aliceUsdc: PublicKey, alicePosition: PublicKey;
  let bobUsdc: PublicKey;
  let aliceTrader: PublicKey, bobTrader: PublicKey;
  let holdingAlice: PublicKey, holdingBob: PublicKey;

  const TICKER = "0005.HK";

  const orderPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("order"), marketPda.toBuffer(), new anchor.BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const airdrop = async (kp: Keypair) => {
    const sig = await conn.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig);
  };

  before(async () => {
    for (const kp of [admin, partner, alice, bob]) await airdrop(kp);
    usdcMint = await createMint(conn, admin, admin.publicKey, null, 6);

    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), admin.publicKey.toBuffer(), Buffer.from(TICKER)],
      program.programId
    );
    [positionMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("position_mint"), marketPda.toBuffer()],
      program.programId
    );
    [marketUsdc] = PublicKey.findProgramAddressSync(
      [Buffer.from("market_usdc"), marketPda.toBuffer()],
      program.programId
    );
    [positionEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("position_escrow"), marketPda.toBuffer()],
      program.programId
    );
    [aliceTrader] = PublicKey.findProgramAddressSync(
      [Buffer.from("trader"), admin.publicKey.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );
    [bobTrader] = PublicKey.findProgramAddressSync(
      [Buffer.from("trader"), admin.publicKey.toBuffer(), bob.publicKey.toBuffer()],
      program.programId
    );
    [holdingAlice] = PublicKey.findProgramAddressSync(
      [Buffer.from("holding"), marketPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );
    [holdingBob] = PublicKey.findProgramAddressSync(
      [Buffer.from("holding"), marketPda.toBuffer(), bob.publicKey.toBuffer()],
      program.programId
    );

    partnerUsdc = await createAccount(conn, admin, usdcMint, partner.publicKey);
    aliceUsdc = await createAccount(conn, admin, usdcMint, alice.publicKey);
    bobUsdc = await createAccount(conn, admin, usdcMint, bob.publicKey);
    await mintTo(conn, admin, usdcMint, aliceUsdc, admin, 100_000 * 1e6);
    await mintTo(conn, admin, usdcMint, bobUsdc, admin, 100_000 * 1e6);

    // Zero spread so the arithmetic in these tests is exact.
    await program.methods
      .initializeMarket({
        ticker: TICKER,
        shareDecimals: 6,
        feeBps: 0,
        minOrderUsdc: USDC(1),
        maxOrderUsdc: USDC(100_000),
      })
      .accounts({
        market: marketPda,
        positionMint,
        marketUsdc,
        positionEscrow,
        usdcMint,
        settlementDestination: partnerUsdc,
        admin: admin.publicKey,
        operator: admin.publicKey,
        treasury: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    alicePosition = await createAccount(conn, admin, positionMint, alice.publicKey);

    for (const [acct, who] of [
      [aliceTrader, alice],
      [bobTrader, bob],
    ] as [PublicKey, Keypair][]) {
      await program.methods
        .registerTrader(true, 344)
        .accounts({
          traderAccount: acct,
          admin: admin.publicKey,
          trader: who.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    }
  });

  it("FIXED: a buy cannot be placed without a quantity floor", async () => {
    await expectError(
      () =>
        program.methods
          .placeBuy(new anchor.BN(0), USDC(10_000), PRICE(50), SHARES(0))
          .accounts({
            market: marketPda,
            order: orderPda(0),
            holding: holdingAlice,
            traderAccount: aliceTrader,
            traderUsdc: aliceUsdc,
            marketUsdc,
            trader: alice.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([alice])
          .rpc(),
      "MissingSlippageProtection"
    );
  });

  it("FIXED: confirm_buy refuses a fill below the trader's minimum", async () => {
    // Alice commits 10,000 USDC, limit 50/share, and will not accept fewer
    // than 190 shares. The honest fill is ~200.
    await program.methods
      .placeBuy(new anchor.BN(0), USDC(10_000), PRICE(50), SHARES(190))
      .accounts({
        market: marketPda,
        order: orderPda(0),
        holding: holdingAlice,
        traderAccount: aliceTrader,
        traderUsdc: aliceUsdc,
        marketUsdc,
        trader: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([alice])
      .rpc();

    await program.methods
      .deployBuy()
      .accounts({
        market: marketPda,
        order: orderPda(0),
        marketUsdc,
        destination: partnerUsdc,
        adminOrOperator: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    // The original exploit: attest ONE share at a price of 1. It still
    // satisfies the price cap (1 <= 50) and the notional bound (1 <= 10,000),
    // so only the quantity floor stops 10,000 USDC becoming a dust position.
    await expectError(
      () =>
        program.methods
          .confirmBuy(SHARES(1), PRICE(1), CUSTODY_REF, DOC_HASH)
          .accounts({
            market: marketPda,
            order: orderPda(0),
            holding: holdingAlice,
            positionMint,
            traderPosition: alicePosition,
            adminOrOperator: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc(),
      "BelowMinimumShares"
    );

    // An honest fill at or above the floor still settles normally.
    await program.methods
      .confirmBuy(SHARES(200), PRICE(49), CUSTODY_REF, DOC_HASH)
      .accounts({
        market: marketPda,
        order: orderPda(0),
        holding: holdingAlice,
        positionMint,
        traderPosition: alicePosition,
        adminOrOperator: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    assert.equal(
      (await getAccount(conn, alicePosition)).amount.toString(),
      SHARES(200).toString()
    );
  });

  it("FIXED: settle_sell cannot pay out of other traders' escrowed funds", async () => {
    // Bob opens a buy. His 5,000 USDC now sits in the shared market account
    // awaiting deployment — it is his, and cancel_buy should always return it.
    await program.methods
      .placeBuy(new anchor.BN(1), USDC(5_000), PRICE(50), SHARES(1))
      .accounts({
        market: marketPda,
        order: orderPda(1),
        holding: holdingBob,
        traderAccount: bobTrader,
        traderUsdc: bobUsdc,
        marketUsdc,
        trader: bob.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([bob])
      .rpc();

    const escrowed = (await getAccount(conn, marketUsdc)).amount;
    assert.equal(escrowed.toString(), USDC(5_000).toString(), "only Bob's escrow is present");

    // Alice sells 1 of her 200 shares.
    await program.methods
      .placeSell(new anchor.BN(2), SHARES(1), PRICE(1))
      .accounts({
        market: marketPda,
        order: orderPda(2),
        holding: holdingAlice,
        traderAccount: aliceTrader,
        positionMint,
        traderPosition: alicePosition,
        positionEscrow,
        trader: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([alice])
      .rpc();

    const aliceBefore = (await getAccount(conn, aliceUsdc)).amount;

    // The original exploit: settle claiming 5,000 of proceeds WITHOUT the
    // broker returning a cent. The SPL balance is sufficient — but it is
    // Bob's escrow, so the payout must be refused.
    await expectError(
      () =>
        program.methods
          .settleSell(USDC(5_000), PRICE(5_000), DOC_HASH)
          .accounts({
            market: marketPda,
            order: orderPda(2),
            holding: holdingAlice,
            positionMint,
            positionEscrow,
            marketUsdc,
            traderUsdc: aliceUsdc,
            adminOrOperator: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc(),
      "InsufficientUnreservedFunds"
    );

    assert.equal(
      (await getAccount(conn, aliceUsdc)).amount.toString(),
      aliceBefore.toString(),
      "Alice was paid nothing — no proceeds had arrived"
    );

    // Bob's escrow is intact and he can still withdraw it.
    assert.equal((await getAccount(conn, marketUsdc)).amount.toString(), USDC(5_000).toString());
    const bobBefore = (await getAccount(conn, bobUsdc)).amount;
    await program.methods
      .cancelBuy()
      .accounts({
        market: marketPda,
        order: orderPda(1),
        marketUsdc,
        traderUsdc: bobUsdc,
        signer: bob.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bob])
      .rpc();
    assert.equal(
      ((await getAccount(conn, bobUsdc)).amount - bobBefore).toString(),
      USDC(5_000).toString(),
      "Bob recovered his escrow in full"
    );

    // Once the broker's proceeds genuinely arrive, the same settlement works.
    await mintTo(conn, admin, usdcMint, marketUsdc, admin, USDC(5_000).toNumber());
    const aliceBefore2 = (await getAccount(conn, aliceUsdc)).amount;
    await program.methods
      .settleSell(USDC(5_000), PRICE(5_000), DOC_HASH)
      .accounts({
        market: marketPda,
        order: orderPda(2),
        holding: holdingAlice,
        positionMint,
        positionEscrow,
        marketUsdc,
        traderUsdc: aliceUsdc,
        adminOrOperator: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    assert.equal(
      ((await getAccount(conn, aliceUsdc)).amount - aliceBefore2).toString(),
      USDC(5_000).toString(),
      "settlement succeeds once the funds are genuinely present"
    );
  });
});
