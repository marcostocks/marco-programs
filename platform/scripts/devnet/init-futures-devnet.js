/**
 * Initialise marco_futures on devnet and open the Moonshot AI market the
 * platform's Futures tab trades. Idempotent: each step checks the account
 * first, so it can be re-run after a partial failure.
 *
 *   node scripts/devnet/init-futures-devnet.js
 *
 * Signs with ~/.config/solana/id.json (admin = operator = treasury), uses the
 * shared test USDC — the deploy wallet holds its mint authority — and writes
 * the result into shared/marco-artifacts/addresses.json, the one place the
 * browser bundle reads addresses from.
 */
const anchor = require('@coral-xyz/anchor');
const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo } = require('@solana/spl-token');
const fs = require('fs'), os = require('os'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ART = path.join(ROOT, 'shared', 'marco-artifacts', 'addresses.json');
const IDL = path.join(ROOT, 'shared', 'marco-artifacts', 'idl', 'marco_futures.json');
const MARKET_ID = process.env.MARKET_ID || 'moon-fut-1';

const USDC = (n) => new BN(Math.round(n)).mul(new BN(1_000_000));
const PRICE = (billions) => new BN(Math.round(billions * 1_000_000));

async function main() {
  const addresses = JSON.parse(fs.readFileSync(ART, 'utf8'));
  const idl = JSON.parse(fs.readFileSync(IDL, 'utf8'));
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json'), 'utf8'))));
  const connection = new Connection(addresses.rpcUrlFallback || addresses.rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: 'confirmed' });
  const program = new anchor.Program(idl, provider);
  const pid = program.programId;
  const usdcMint = new PublicKey(addresses.usdc.mint);

  const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, pid)[0];
  const config = pda(Buffer.from('config'));
  const market = pda(Buffer.from('market'), config.toBuffer(), Buffer.from(MARKET_ID));
  const collateralVault = pda(Buffer.from('collateral'), market.toBuffer());
  const insuranceVault = pda(Buffer.from('insurance'), market.toBuffer());

  if (!(await connection.getAccountInfo(config))) {
    const sig = await program.methods.initialize().accounts({
      config, admin: kp.publicKey, operator: kp.publicKey, treasury: kp.publicKey,
      usdcMint, systemProgram: SystemProgram.programId,
    }).rpc();
    console.log('initialize', sig);
  } else console.log('config exists', config.toBase58());

  if (!(await connection.getAccountInfo(market))) {
    const sig = await program.methods.createMarket({
      marketId: MARKET_ID,
      anchorPrice: PRICE(50),               // $50B — the Futures tab's anchor
      quoteReserve: USDC(2_000_000),        // shallow enough that a demo ticket visibly moves the mark
      maxLeverage: 10,
      maintenanceMarginBps: 625,
      takerFeeBps: 30,
      liquidationFeeBps: 100,
      maxOiNotional: USDC(5_000_000),
      expiryTs: new BN(Math.floor(Date.UTC(2027, 2, 31) / 1000)),
    }).accounts({
      config, market, usdcMint, collateralVault, insuranceVault, admin: kp.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    }).rpc();
    console.log('create_market', sig);

    const funder = (await getOrCreateAssociatedTokenAccount(connection, kp, usdcMint, kp.publicKey)).address;
    await mintTo(connection, kp, usdcMint, funder, kp, BigInt(USDC(250_000).toString()));
    const sig2 = await program.methods.seedInsurance(USDC(250_000)).accounts({
      market, insuranceVault, funderUsdc: funder, funder: kp.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    console.log('seed_insurance', sig2);
  } else console.log('market exists', market.toBase58());

  addresses.programs.marcoFutures = pid.toBase58();
  addresses.futures = { marketId: MARKET_ID, market: market.toBase58(), config: config.toBase58(),
    collateralVault: collateralVault.toBase58(), insuranceVault: insuranceVault.toBase58() };
  fs.writeFileSync(ART, JSON.stringify(addresses, null, 2) + '\n');
  console.log('wrote', ART);
}
main().catch((e) => { console.error(e); process.exit(1); });
