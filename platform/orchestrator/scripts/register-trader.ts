/**
 * Register a wallet as an eligible trader on the devnet spot market.
 *   npx tsx scripts/register-trader.ts <WALLET> [jurisdiction]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Keypair } from '@solana/web3.js';
import { SolanaChain } from '../src/adapters/solana/chain.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { systemClock } from '../src/domain/clock.js';
import { ConsoleLogger } from '../src/support/logger.js';

const WALLET = process.argv[2];
const JURISDICTION = Number(process.argv[3] ?? 344);
if (!WALLET) { console.error('usage: register-trader.ts <WALLET> [jurisdiction]'); process.exit(1); }

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, 'utf8'))));
const artifacts = loadArtifacts();
const chain = new SolanaChain({ clock: systemClock, logger: new ConsoleLogger('info'), rpcUrl: artifacts.addresses.rpcUrl, operator: kp, admin: kp, artifacts });
const r = await chain.registerTrader(WALLET, JURISDICTION);
console.log('registerTrader:', r.alreadyApplied ? 'already eligible' : r.signature);
console.log('on-chain record:', JSON.stringify(await chain.getTraderAccount(WALLET)));
