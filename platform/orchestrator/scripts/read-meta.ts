import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';

const TM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const k = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace('~', process.env.HOME!), 'utf8'))));

function str(buf: Buffer, off: number): [string, number] {
  const n = buf.readUInt32LE(off);
  return [buf.subarray(off + 4, off + 4 + n).toString('utf8').replace(/\0+$/, ''), off + 4 + n];
}

async function main() {
  const a = loadArtifacts();
  const admin = k('~/.config/solana/id.json');
  const conn = new Connection(a.addresses.rpcUrl, 'confirmed');
  for (const id of ['moon-2026-s', 'unitree-2026-s', 'red-2026', 'byte-2026-r', 'byte-2026-s']) {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), admin.publicKey.toBuffer(), Buffer.from(id)], a.vaultProgramId);
    const [mint] = PublicKey.findProgramAddressSync(
      [Buffer.from('share_mint'), vault.toBuffer()], a.vaultProgramId);
    const [meta] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TM.toBuffer(), mint.toBuffer()], TM);
    const info = await conn.getAccountInfo(meta);
    if (!info) { console.log(`${id.padEnd(16)} mint ${mint.toBase58()}  NO METADATA`); continue; }
    let o = 1 + 32 + 32;
    const [name, o2] = str(info.data, o);
    const [symbol] = str(info.data, o2);
    console.log(`${id.padEnd(16)} mint ${mint.toBase58()}  ${symbol.padEnd(7)} ${name}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
