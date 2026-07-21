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
  transferChecked,
} from "@solana/spl-token";
import { assert } from "chai";

const USDC = (n: number) => new anchor.BN(Math.round(n * 1e6));
/// Shares carry the same 6 decimals as USDC.
const SHARES = (n: number) => new anchor.BN(Math.round(n * 1e6));
/// Price is USDC per whole share, 6dp.
const PRICE = (n: number) => new anchor.BN(Math.round(n * 1e6));

const CUSTODY_REF = Buffer.alloc(32, 7);
const DOC_HASH = Buffer.alloc(32, 9);
const ZERO_32 = Buffer.alloc(32, 0);

/// Assert a call fails for the *specific* reason expected. A bare
/// try/catch would pass on any error — including a malformed account list —
/// and quietly stop testing the invariant it was written for.
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

describe("marco-spot", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MarcoSpot as Program<MarcoSpot>;
  const conn = provider.connection;

  const admin = Keypair.generate();
  const operator = Keypair.generate();
  const treasury = Keypair.generate();
  const partner = Keypair.generate(); // conversion partner
  const alice = Keypair.generate();
  const mallory = Keypair.generate(); // never made eligible

  let usdcMint: PublicKey;
  let marketPda: PublicKey, positionMint: PublicKey;
  let marketUsdc: PublicKey, positionEscrow: PublicKey;
  let partnerUsdc: PublicKey, treasuryUsdc: PublicKey;
  let aliceUsdc: PublicKey, alicePosition: PublicKey;
  let malloryUsdc: PublicKey;
  let aliceTrader: PublicKey, malloryTrader: PublicKey;
  let holdingAlice: PublicKey;

  const TICKER = "0700.HK";
  const FEE_BPS = 50; // 0.50% trading spread

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
    for (const kp of [admin, operator, treasury, partner, alice, mallory]) await airdrop(kp);

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
    [malloryTrader] = PublicKey.findProgramAddressSync(
      [Buffer.from("trader"), admin.publicKey.toBuffer(), mallory.publicKey.toBuffer()],
      program.programId
    );
    [holdingAlice] = PublicKey.findProgramAddressSync(
      [Buffer.from("holding"), marketPda.toBuffer(), alice.publicKey.toBuffer()],
      program.programId
    );

    partnerUsdc = await createAccount(conn, admin, usdcMint, partner.publicKey);
    treasuryUsdc = await createAccount(conn, admin, usdcMint, treasury.publicKey);
    aliceUsdc = await createAccount(conn, admin, usdcMint, alice.publicKey);
    malloryUsdc = await createAccount(conn, admin, usdcMint, mallory.publicKey);

    await mintTo(conn, admin, usdcMint, aliceUsdc, admin, 1_000_000 * 1e6);
    await mintTo(conn, admin, usdcMint, malloryUsdc, admin, 1_000_000 * 1e6);
  });

  it("creates a market with an immutable settlement destination", async () => {
    await program.methods
      .initializeMarket({
        ticker: TICKER,
        shareDecimals: 6,
        feeBps: FEE_BPS,
        minOrderUsdc: USDC(10),
        maxOrderUsdc: USDC(500_000),
      })
      .accounts({
        market: marketPda,
        positionMint,
        marketUsdc,
        positionEscrow,
        usdcMint,
        settlementDestination: partnerUsdc,
        admin: admin.publicKey,
        operator: operator.publicKey,
        treasury: treasury.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.ticker, TICKER);
    assert.equal(m.settlementDestination.toBase58(), partnerUsdc.toBase58());
    assert.deepEqual(m.status, { active: {} });
    assert.isTrue(m.transferLock, "Phase 1 positions must start locked");
    assert.equal(m.feeBps, FEE_BPS);

    alicePosition = await createAccount(conn, admin, positionMint, alice.publicKey);
  });

  it("registers an eligible trader", async () => {
    await program.methods
      .registerTrader(true, 344) // 344 = Hong Kong
      .accounts({
        traderAccount: aliceTrader,
        admin: admin.publicKey,
        trader: alice.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const t = await program.account.traderAccount.fetch(aliceTrader);
    assert.isTrue(t.eligible);
    assert.equal(t.jurisdiction, 344);
  });

  it("rejects a buy from a trader who was never verified", async () => {
    // Register Mallory as explicitly NOT eligible so the account exists.
    await program.methods
      .registerTrader(false, 0)
      .accounts({
        traderAccount: malloryTrader,
        admin: admin.publicKey,
        trader: mallory.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const [holdingM] = PublicKey.findProgramAddressSync(
      [Buffer.from("holding"), marketPda.toBuffer(), mallory.publicKey.toBuffer()],
      program.programId
    );

    await expectError(
      () =>
        program.methods
          .placeBuy(new anchor.BN(0), USDC(1_000), PRICE(50))
          .accounts({
            market: marketPda,
            order: orderPda(0),
            holding: holdingM,
            traderAccount: malloryTrader,
            traderUsdc: malloryUsdc,
            marketUsdc,
            trader: mallory.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([mallory])
          .rpc(),
      "TraderNotEligible"
    );
  });

  it("places a buy and escrows the stablecoins", async () => {
    const before = (await getAccount(conn, aliceUsdc)).amount;

    await program.methods
      .placeBuy(new anchor.BN(0), USDC(10_000), PRICE(50))
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

    const after = (await getAccount(conn, aliceUsdc)).amount;
    assert.equal((before - after).toString(), USDC(10_000).toString());
    assert.equal((await getAccount(conn, marketUsdc)).amount.toString(), USDC(10_000).toString());

    const o = await program.account.order.fetch(orderPda(0));
    assert.deepEqual(o.status, { pending: {} });
    assert.deepEqual(o.side, { buy: {} });

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.usdcEscrowed.toString(), USDC(10_000).toString());
    // Critically: no position exists yet.
    assert.equal(m.totalSharesOutstanding.toString(), "0");
  });

  it("refuses to deploy to any account but the settlement destination", async () => {
    const rogue = await createAccount(conn, admin, usdcMint, operator.publicKey);
    await expectError(
      () =>
        program.methods
          .deployBuy()
          .accounts({
            market: marketPda,
            order: orderPda(0),
            marketUsdc,
            destination: rogue,
            adminOrOperator: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc(),
      "WrongDestination"
    );
  });

  it("deploys to the conversion partner and takes the spread", async () => {
    await program.methods
      .deployBuy()
      .accounts({
        market: marketPda,
        order: orderPda(0),
        marketUsdc,
        destination: partnerUsdc,
        adminOrOperator: operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([operator])
      .rpc();

    // 0.50% of 10,000 = 50 spread; 9,950 wired out.
    assert.equal((await getAccount(conn, partnerUsdc)).amount.toString(), USDC(9_950).toString());

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.feesCollected.toString(), USDC(50).toString());
    assert.equal(m.usdcEscrowed.toString(), "0");

    const o = await program.account.order.fetch(orderPda(0));
    assert.deepEqual(o.status, { deployed: {} });
    assert.equal(o.deployedAmount.toString(), USDC(9_950).toString());
  });

  it("rejects an attestation with no supporting document hash", async () => {
    await expectError(
      () =>
        program.methods
          .confirmBuy(SHARES(200), PRICE(49), CUSTODY_REF, ZERO_32)
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
      "InvalidAttestation"
    );
  });

  it("rejects a fill worse than the trader's limit price", async () => {
    // Limit was 50; attesting 51 must be refused.
    await expectError(
      () =>
        program.methods
          .confirmBuy(SHARES(190), PRICE(51), CUSTODY_REF, DOC_HASH)
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
      "LimitPriceExceeded"
    );
  });

  it("rejects an attested notional larger than the capital deployed", async () => {
    // 1,000 shares @ 49 = 49,000 notional vs 9,950 deployed.
    await expectError(
      () =>
        program.methods
          .confirmBuy(SHARES(1_000), PRICE(49), CUSTODY_REF, DOC_HASH)
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
      "NotionalMismatch"
    );
  });

  it("confirms custody and mints a locked position", async () => {
    // 200 shares @ 49 = 9,800 notional, within the 9,950 deployed.
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

    const pos = await getAccount(conn, alicePosition);
    assert.equal(pos.amount.toString(), SHARES(200).toString());
    assert.isTrue(pos.isFrozen, "Phase 1 positions must be locked on mint");

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.totalSharesOutstanding.toString(), SHARES(200).toString());

    const o = await program.account.order.fetch(orderPda(0));
    assert.deepEqual(o.status, { filled: {} });
    assert.deepEqual(Buffer.from(o.custodyRef), CUSTODY_REF);
    assert.deepEqual(Buffer.from(o.docHash), DOC_HASH);

    const h = await program.account.holding.fetch(holdingAlice);
    assert.equal(h.sharesBought.toString(), SHARES(200).toString());
  });

  it("locks the position — the holder cannot transfer it", async () => {
    const bobPosition = await createAccount(
      conn,
      admin,
      positionMint,
      Keypair.generate().publicKey
    );
    let msg = "";
    try {
      await transferChecked(
        conn,
        alice,
        alicePosition,
        positionMint,
        bobPosition,
        alice,
        BigInt(SHARES(1).toString()),
        6
      );
    } catch (e: any) {
      msg = `${e?.message ?? e} ${JSON.stringify(e?.logs ?? [])}`;
    }
    // 0x11 is the SPL token program's AccountFrozen. Asserting on the actual
    // freeze rather than "something threw" keeps this testing the lock.
    assert.match(
      msg,
      /frozen|0x11/i,
      `expected a frozen-account rejection, got: ${msg || "no error at all"}`
    );
  });

  it("places a sell, escrowing the position without burning it", async () => {
    await program.methods
      .placeSell(new anchor.BN(1), SHARES(80), PRICE(40))
      .accounts({
        market: marketPda,
        order: orderPda(1),
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

    assert.equal((await getAccount(conn, positionEscrow)).amount.toString(), SHARES(80).toString());

    const pos = await getAccount(conn, alicePosition);
    assert.equal(pos.amount.toString(), SHARES(120).toString());
    assert.isTrue(pos.isFrozen, "the remaining balance must stay locked");

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.sharesEscrowed.toString(), SHARES(80).toString());
    // Supply still matches custody — nothing burned yet.
    assert.equal(m.totalSharesOutstanding.toString(), SHARES(200).toString());
  });

  it("cancels a sell and returns the escrowed position", async () => {
    await program.methods
      .placeSell(new anchor.BN(2), SHARES(20), PRICE(40))
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

    await program.methods
      .cancelSell()
      .accounts({
        market: marketPda,
        order: orderPda(2),
        positionMint,
        positionEscrow,
        traderPosition: alicePosition,
        signer: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    const pos = await getAccount(conn, alicePosition);
    assert.equal(pos.amount.toString(), SHARES(120).toString());
    assert.isTrue(pos.isFrozen, "a returned position must be re-locked");

    const o = await program.account.order.fetch(orderPda(2));
    assert.deepEqual(o.status, { cancelled: {} });
  });

  it("settles the sell, burning the escrow and paying the trader", async () => {
    // Broker returns proceeds on-chain before settlement.
    await mintTo(conn, admin, usdcMint, marketUsdc, admin, USDC(4_000).toNumber());

    const before = (await getAccount(conn, aliceUsdc)).amount;

    await program.methods
      .settleSell(USDC(4_000), PRICE(50), DOC_HASH)
      .accounts({
        market: marketPda,
        order: orderPda(1),
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

    // 0.50% of 4,000 = 20 spread; 3,980 to the trader.
    const after = (await getAccount(conn, aliceUsdc)).amount;
    assert.equal((after - before).toString(), USDC(3_980).toString());

    assert.equal((await getAccount(conn, positionEscrow)).amount.toString(), "0");

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.totalSharesOutstanding.toString(), SHARES(120).toString());
    assert.equal(m.sharesEscrowed.toString(), "0");
    assert.equal(m.feesCollected.toString(), USDC(70).toString()); // 50 + 20
  });

  it("refunds a buy cancelled before deployment", async () => {
    const before = (await getAccount(conn, aliceUsdc)).amount;

    await program.methods
      .placeBuy(new anchor.BN(3), USDC(2_000), PRICE(60))
      .accounts({
        market: marketPda,
        order: orderPda(3),
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
      .cancelBuy()
      .accounts({
        market: marketPda,
        order: orderPda(3),
        marketUsdc,
        traderUsdc: aliceUsdc,
        signer: alice.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([alice])
      .rpc();

    // Refunded in full — no spread is earned on capital that never deployed.
    const after = (await getAccount(conn, aliceUsdc)).amount;
    assert.equal(after.toString(), before.toString());

    const m = await program.account.market.fetch(marketPda);
    assert.equal(m.usdcEscrowed.toString(), "0");
  });

  it("blocks new orders while the market is paused, then reopens", async () => {
    await program.methods
      .setMarketStatus({ paused: {} })
      .accounts({ market: marketPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    await expectError(
      () =>
        program.methods
          .placeBuy(new anchor.BN(4), USDC(1_000), PRICE(60))
          .accounts({
            market: marketPda,
            order: orderPda(4),
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
      "MarketNotActive"
    );

    await program.methods
      .setMarketStatus({ active: {} })
      .accounts({ market: marketPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();
  });

  it("bounds the fee sweep by what was actually collected", async () => {
    await expectError(
      () =>
        program.methods
          .sweepFee(USDC(1_000)) // only 70 collected
          .accounts({
            market: marketPda,
            marketUsdc,
            treasuryUsdc,
            admin: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc(),
      "FeeSweepExceedsCollected"
    );

    await program.methods
      .sweepFee(USDC(70))
      .accounts({
        market: marketPda,
        marketUsdc,
        treasuryUsdc,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    assert.equal((await getAccount(conn, treasuryUsdc)).amount.toString(), USDC(70).toString());
  });

  it("moves to Phase 2: admin unlocks, holders thaw, transfer works", async () => {
    await expectError(
      () =>
        program.methods
          .unlockPosition()
          .accounts({
            market: marketPda,
            positionMint,
            holderPosition: alicePosition,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "TransferLockActive"
    );

    await program.methods
      .setTransferLock(false)
      .accounts({ market: marketPda, admin: admin.publicKey })
      .signers([admin])
      .rpc();

    // Clearing the flag alone does not thaw: SPL freezes are per-account.
    assert.isTrue((await getAccount(conn, alicePosition)).isFrozen);

    await program.methods
      .unlockPosition()
      .accounts({
        market: marketPda,
        positionMint,
        holderPosition: alicePosition,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert.isFalse((await getAccount(conn, alicePosition)).isFrozen);

    const bob = Keypair.generate();
    const bobPosition = await createAccount(conn, admin, positionMint, bob.publicKey);
    await transferChecked(
      conn,
      alice,
      alicePosition,
      positionMint,
      bobPosition,
      alice,
      BigInt(SHARES(5).toString()),
      6
    );
    assert.equal((await getAccount(conn, bobPosition)).amount.toString(), SHARES(5).toString());
  });
});
