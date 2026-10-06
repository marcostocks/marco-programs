/** Decode a holder's BuyerState against a vault, with the IDL. */
import { readFileSync } from 'node:fs';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';

const VAULT_ID = process.env.VAULT_ID ?? 'byte-2026-r';
const HOLDER = process.env.HOLDER ?? 'FzmTPA3AcsWMBxpc3ujP3J5opETignkXEYaCavskuUyL';
const k = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace('~', process.env.HOME!), 'utf8'))));

async function main() {
  const a = loadArtifacts();
  const admin = k('~/.config/solana/id.json');
  const conn = new Connection(a.addresses.rpcUrl, 'confirmed');
  const prov = new AnchorProvider(conn, new Wallet(admin), { commitment: 'confirmed' });
  const prog = new Program(a.vaultIdl as never, prov) as unknown as {
    account: { buyerState: { fetch: (p: PublicKey) => Promise<Record<string, unknown>> } };
  };
  const holder = new PublicKey(HOLDER);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), admin.publicKey.toBuffer(), Buffer.from(VAULT_ID)], a.vaultProgramId);
  const [buyer] = PublicKey.findProgramAddressSync(
    [Buffer.from('buyer'), vault.toBuffer(), holder.toBuffer()], a.vaultProgramId);
  const [mint] = PublicKey.findProgramAddressSync(
    [Buffer.from('share_mint'), vault.toBuffer()], a.vaultProgramId);

  console.log(`${VAULT_ID} · BuyerState ${buyer.toBase58()}`);
  const b = await prog.account.buyerState.fetch(buyer);
  for (const [key, val] of Object.entries(b)) {
    const s = (val as { toString(): string })?.toString?.() ?? String(val);
    console.log(`  ${key.padEnd(20)} ${/^\d+$/.test(s) && s.length > 4 ? (Number(s) / 1e6).toLocaleString() : s}`);
  }
  const ata = await conn.getTokenAccountsByOwner(holder, { mint });
  for (const t of ata.value) {
    const bal = await conn.getTokenAccountBalance(t.pubkey);
    console.log(`\n  actual token balance ${Number(bal.value.uiAmountString).toLocaleString()}`);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
