/** Everything about these vaults that a third party can verify on Solana Explorer. */
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';

const WALLET = process.env.WALLET ?? 'FzmTPA3AcsWMBxpc3ujP3J5opETignkXEYaCavskuUyL';
const IDS = ['moon-2026-s', 'unitree-2026-s', 'red-2026', 'byte-2026-r'];
const k = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace('~', process.env.HOME!), 'utf8'))));
const link = (kind: string, a: string) => `https://explorer.solana.com/${kind}/${a}?cluster=devnet`;

async function main() {
  const a = loadArtifacts();
  const admin = k('~/.config/solana/id.json');
  const conn = new Connection(a.addresses.rpcUrl, 'confirmed');
  const me = new PublicKey(WALLET);

  console.log(`program        ${link('address', a.vaultProgramId.toBase58())}\n`);

  for (const id of IDS) {
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), admin.publicKey.toBuffer(), Buffer.from(id)], a.vaultProgramId);
    const [mint] = PublicKey.findProgramAddressSync(
      [Buffer.from('share_mint'), vault.toBuffer()], a.vaultProgramId);
    const [buyer] = PublicKey.findProgramAddressSync(
      [Buffer.from('buyer'), vault.toBuffer(), me.toBuffer()], a.vaultProgramId);
    const sigs = await conn.getSignaturesForAddress(vault, { limit: 4 });
    const mine = await conn.getAccountInfo(buyer);

    console.log(`── ${id}`);
    console.log(`   vault account   ${link('address', vault.toBase58())}`);
    console.log(`   claim mint      ${link('address', mint.toBase58())}`);
    console.log(`   your position   ${mine ? link('address', buyer.toBase58()) : '(no BuyerState — you have not subscribed here)'}`);
    for (const s of sigs) console.log(`   tx              ${link('tx', s.signature)}`);
    console.log();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
