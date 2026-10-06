/**
 * Every marco-vault account on the cluster, decoded — not a hand-kept list.
 *
 *   npx tsx scripts/list-vaults.ts
 *
 * Fetches all accounts owned by the program and decodes them with the IDL, so
 * a vault seeded by any script or by anyone shows up here.
 */
import { readFileSync } from 'node:fs';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadArtifacts } from '../src/adapters/solana/artifacts.js';

const k = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace('~', process.env.HOME!), 'utf8'))));
const n = (x: bigint | number) => Number(x).toLocaleString();

async function main() {
  const a = loadArtifacts();
  const conn = new Connection(a.addresses.rpcUrl, 'confirmed');
  const provider = new AnchorProvider(conn, new Wallet(k('~/.config/solana/id.json')), {
    commitment: 'confirmed',
  });
  const program = new Program(a.vaultIdl as never, provider) as unknown as {
    account: { vault: { all: () => Promise<{ publicKey: PublicKey; account: Record<string, any> }[]> } };
  };

  const all = await program.account.vault.all();
  all.sort((x, y) => String(x.account.vaultId).localeCompare(String(y.account.vaultId)));

  console.log(`${all.length} vaults on ${a.addresses.cluster}\n`);
  for (const { publicKey, account } of all) {
    const [mint] = PublicKey.findProgramAddressSync(
      [Buffer.from('share_mint'), publicKey.toBuffer()], a.vaultProgramId);
    const phase = Object.keys(account.phase ?? {})[0] ?? '?';
    const cap = Number(account.depositCap ?? 0) / 1e6;
    const dep = Number(account.totalDeposits ?? 0) / 1e6;
    console.log(`${String(account.vaultId)}`);
    console.log(`   vault      ${publicKey.toBase58()}`);
    console.log(`   claim mint ${mint.toBase58()}`);
    console.log(`   ${phase} · ${n(dep)} / ${n(cap)} USDC · fee ${Number(account.feeBps) / 100}% at ` +
      `${account.feeAtExit ? 'redemption' : 'deposit'}`);
    console.log();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
