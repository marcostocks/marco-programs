/** What has a wallet done on the devnet deployment? Read-only. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { SolanaChain } from '../src/adapters/solana/chain.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { systemClock } from '../src/domain/clock.js';
import { ConsoleLogger } from '../src/support/logger.js';

const WALLET = process.argv[2]!;
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))));
const artifacts = loadArtifacts();
const chain = new SolanaChain({ clock: systemClock, logger: new ConsoleLogger('warn'), rpcUrl: artifacts.addresses.rpcUrl, operator: kp, admin: kp, artifacts });

const vault = await chain.getVault('moon-2026');
console.log(`vault moon-2026: phase ${vault?.phase} · deposits ${Number(vault?.totalDeposits.amount ?? 0n)/1e6} USDC · shares ${Number(vault?.totalShares ?? 0n)/1e6}`);

const market = await chain.getMarket('0700.HK');
console.log(`market 0700.HK: orderSeq is next id · escrow ${Number(market?.escrowBalance.amount ?? 0n)/1e6} USDC · supply ${Number(market?.positionSupply.units ?? 0n)/1e6}`);

// their orders: scan the few order ids that exist
for (let id = 0; id < 10; id++) {
  const o = await chain.getSpotOrder('0700.HK', String(id)).catch(() => null);
  if (o && o.trader === WALLET) {
    console.log(`  order #${id}: ${o.side} ${o.state} · escrowed ${o.escrowedAmount ? Number(o.escrowedAmount.amount)/1e6 + ' USDC' : '-'} · limit ${Number(o.limitPrice.amount)/1e6}`);
  }
}
