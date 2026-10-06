/** Read every known vault and confirm it still decodes after a program upgrade. */
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { SolanaChain } from '../src/adapters/solana/chain.js';
import { systemClock } from '../src/domain/clock.js';
import { ConsoleLogger } from '../src/support/logger.js';

const IDS = ['moon-2026', 'moon-2026-s', 'unitree-2026-s', 'red-2026', 'byte-2026-s', 'byte-2026-r'];
const k = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace('~', process.env.HOME!), 'utf8'))));

async function main() {
  const a = loadArtifacts();
  const c = new SolanaChain({
    clock: systemClock, logger: new ConsoleLogger('error'), rpcUrl: a.addresses.rpcUrl,
    operator: k('~/.config/solana/id.json'), admin: k('~/.config/solana/id.json'), artifacts: a,
  });
  for (const id of IDS) {
    try {
      const v: any = await c.getVault(id);
      if (!v) { console.log(`${id.padEnd(16)} (not on this cluster)`); continue; }
      console.log(
        `${id.padEnd(16)} ${String(v.phase).padEnd(10)} ` +
        `${(Number(v.totalDeposits.amount) / 1e6).toLocaleString().padStart(9)} / ` +
        `${(Number(v.cap.amount) / 1e6).toLocaleString().padEnd(9)} USDC  ` +
        `feeAtExit=${v.feeAtExit}  mint=${v.shareMint ?? '?'}`,
      );
    } catch (e) { console.log(`${id.padEnd(16)} FAILED TO DECODE — ${(e as Error).message}`); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
