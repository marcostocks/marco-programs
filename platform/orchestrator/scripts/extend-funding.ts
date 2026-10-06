/** Admin: extend the funding deadline of the open vaults to Aug 31 2026 23:59:59 UTC. */
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';

const ROOT = '/Users/tonytran/Documents/Claude/Projects/Marco';
const addresses = JSON.parse(readFileSync(`${ROOT}/shared/marco-artifacts/addresses.json`, 'utf8'));
const idl = JSON.parse(readFileSync(`${ROOT}/shared/marco-artifacts/idl/marco_vault.json`, 'utf8'));
const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')) as number[]),
);

const programId = new PublicKey(addresses.programs.marcoVault);
const adminPk = new PublicKey(addresses.wallets.admin);
const conn = new Connection(addresses.rpcUrl, 'confirmed');
const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: 'confirmed' });
const program: any = new Program(idl, provider);

const VAULTS = ['moon-2026-s', 'unitree-2026-s', 'byte-2026-l']; // the Funding-phase vaults the site shows as Open
// Pass an ISO date to override, e.g. `npx tsx scripts/extend-funding.ts 2026-12-31T23:59:59Z`;
// default is end of November 2026 (UTC).
const DEADLINE = process.argv[2]
  ? Math.floor(Date.parse(process.argv[2]) / 1000)
  : Math.floor(Date.UTC(2026, 10, 30, 23, 59, 59) / 1000);

const pda = (id: string) =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), adminPk.toBuffer(), Buffer.from(id)], programId)[0];
const iso = (n: number) => new Date(n * 1000).toISOString();

async function main() {
  console.log(`admin ${adminPk.toBase58()}`);
  console.log(`target deadline ${DEADLINE} (${iso(DEADLINE)})\n`);
  for (const id of VAULTS) {
    const vault = pda(id);
    try {
      const sig = await program.methods
        .setFundingDeadline(new BN(DEADLINE))
        .accountsPartial({ vault, admin: adminPk })
        .rpc();
      const v: any = await program.account.vault.fetch(vault);
      const now = Math.floor(Date.now() / 1000);
      console.log(
        `${id.padEnd(16)} OK  deadline -> ${iso(Number(v.fundingDeadline.toString()))}` +
        ` (${now < Number(v.fundingDeadline.toString()) ? 'OPEN' : 'still closed?!'})  sig ${sig.slice(0, 16)}…`,
      );
    } catch (e) {
      console.log(`${id.padEnd(16)} FAILED — ${(e as Error).message}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
