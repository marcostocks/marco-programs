/** Claim-token supply against each vault's deposits and cap. */
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';
import { SolanaChain } from '../src/adapters/solana/chain.js';
import { systemClock } from '../src/domain/clock.js';
import { ConsoleLogger } from '../src/support/logger.js';

const IDS = ['moon-2026', 'moon-2026-s', 'unitree-2026-s', 'red-2026', 'byte-2026-r', 'byte-2026-s'];
const k = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace('~', process.env.HOME!), 'utf8'))));
const n = (x: number) => x.toLocaleString();

async function main() {
  const a = loadArtifacts();
  const admin = k('~/.config/solana/id.json');
  const conn = new Connection(a.addresses.rpcUrl, 'confirmed');
  const chain = new SolanaChain({
    clock: systemClock, logger: new ConsoleLogger('error'), rpcUrl: a.addresses.rpcUrl,
    operator: admin, admin, artifacts: a,
  });
  console.log('vault              cap        deposits    supply     fee timing   supply == ?');
  for (const id of IDS) {
    const v: any = await chain.getVault(id);
    if (!v) continue;
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), admin.publicKey.toBuffer(), Buffer.from(id)], a.vaultProgramId);
    const [mint] = PublicKey.findProgramAddressSync(
      [Buffer.from('share_mint'), vault.toBuffer()], a.vaultProgramId);
    const sup = await conn.getTokenSupply(mint);
    const supply = Number(sup.value.amount) / 1e6;
    const dep = Number(v.totalDeposits.amount) / 1e6;
    const cap = Number(v.cap.amount) / 1e6;
    const rel = supply === dep ? 'deposits (1:1)' : `deposits less ${(((dep - supply) / dep) * 100).toFixed(1)}%`;
    console.log(
      `${id.padEnd(16)} ${n(cap).padStart(9)} ${n(dep).padStart(11)} ${n(supply).padStart(10)}   ` +
      `${(v.feeAtExit ? 'at exit' : 'at entry').padEnd(11)}  ${rel}`,
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
