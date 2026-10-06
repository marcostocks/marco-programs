/**
 * Put every market on the platform's Trade page on chain: one marco_spot
 * market per ticker, all on the shared test USDC at a 25 bps spread.
 * Idempotent — an existing market is kept (and its fee aligned), never re-made.
 *
 *   node scripts/devnet/init-spot-markets-devnet.js
 *
 * Signs with ~/.config/solana/id.json (admin = operator = treasury). Writes
 * addresses.spot = { ticker: marketPda } into shared/marco-artifacts/addresses.json.
 * Trader eligibility is per admin, so a wallet registered once (register_trader)
 * can trade every one of these.
 */
const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs'), os = require('os'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ART = path.join(ROOT, 'shared', 'marco-artifacts', 'addresses.json');
const idl = require(path.join(ROOT, 'shared', 'marco-artifacts', 'idl', 'marco_spot.json'));

// The platform's market id → the ticker its marco_spot market is keyed by.
// Listed HK names use their HKEX code; the rest use their symbol.
const TICKERS = {
  zhipu: '2513.HK', minimax: '0100.HK', smic: '0981.HK', cxmt: 'CXMT',
  baba: '9988.HK', tencent: '0700.HK', xiaomi: '1810.HK', pdd: 'PDD',
  jd: '9618.HK', meituan: '3690.HK', nio: '9866.HK', hrbt: '9660.HK',
  btc: 'BTC', eth: 'ETH',
};
const FEE_BPS = 25;
// Where deploy_buy sends a buy's USDC — the simulated conversion partner the
// 0700.HK market has always used. Shared, since every partner here is a mock.
const SETTLEMENT = new PublicKey('DWy98MywcJz7BH6GPm4vpyKgrrTQRZSEhSJgCbtwfk4P');
const USDC = (n) => new anchor.BN(Math.round(n * 1e6));

async function main() {
  const addresses = JSON.parse(fs.readFileSync(ART, 'utf8'));
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json'), 'utf8'))));
  const connection = new Connection(addresses.rpcUrlFallback || addresses.rpcUrl, 'confirmed');
  const program = new anchor.Program(idl, new anchor.AnchorProvider(connection, new anchor.Wallet(kp), { commitment: 'confirmed' }));
  const pid = program.programId, usdcMint = new PublicKey(addresses.usdc.mint);
  const pda = (...s) => PublicKey.findProgramAddressSync(s, pid)[0];

  const out = {};
  for (const [id, ticker] of Object.entries(TICKERS)) {
    const market = pda(Buffer.from('market'), kp.publicKey.toBuffer(), Buffer.from(ticker));
    out[ticker] = market.toBase58();
    const existing = await connection.getAccountInfo(market);
    if (existing) {
      const m = await program.account.market.fetch(market);
      if (m.feeBps !== FEE_BPS) {
        const sig = await program.methods.setFeeBps(FEE_BPS)
          .accountsPartial({ market, admin: kp.publicKey }).rpc();
        console.log(`${ticker.padEnd(8)} exists · fee ${m.feeBps} → ${FEE_BPS} bps  ${sig}`);
      } else console.log(`${ticker.padEnd(8)} exists · ${market.toBase58()}`);
      continue;
    }
    const sig = await program.methods.initializeMarket({
      ticker, shareDecimals: 6, feeBps: FEE_BPS, minOrderUsdc: USDC(10), maxOrderUsdc: USDC(500_000),
    }).accountsPartial({
      market,
      positionMint: pda(Buffer.from('position_mint'), market.toBuffer()),
      marketUsdc: pda(Buffer.from('market_usdc'), market.toBuffer()),
      positionEscrow: pda(Buffer.from('position_escrow'), market.toBuffer()),
      usdcMint, settlementDestination: SETTLEMENT,
      admin: kp.publicKey, operator: kp.publicKey, treasury: kp.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    }).rpc();
    console.log(`${ticker.padEnd(8)} created · ${market.toBase58()}  ${sig}`);
  }
  addresses.spot = out;
  fs.writeFileSync(ART, JSON.stringify(addresses, null, 2) + '\n');
  console.log('wrote', ART);
}
main().catch((e) => { console.error(e); process.exit(1); });
