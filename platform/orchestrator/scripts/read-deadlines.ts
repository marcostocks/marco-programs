/** Read-only: phase + funding_deadline for every frontend vault. */
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';

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

const IDS = ['moon-2026-s', 'unitree-2026-s', 'red-2026', 'byte-2026-r', 'moon-2026', 'byte-2026-s', 'unitree-2026'];
const pda = (id: string) =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), adminPk.toBuffer(), Buffer.from(id)], programId)[0];
const iso = (x: any) => { const n = Number(x?.toString?.() ?? x); return n ? new Date(n * 1000).toISOString() : `${n}`; };
const now = Math.floor(Date.now() / 1000);

for (const id of IDS) {
  try {
    const v: any = await program.account.vault.fetch(pda(id));
    const phase = Object.keys(v.phase)[0];
    const dl = Number(v.fundingDeadline.toString());
    console.log(
      `${id.padEnd(16)} phase=${phase.padEnd(10)} deadline=${iso(v.fundingDeadline)}` +
      ` ${now >= dl ? 'CLOSED' : 'open  '}  start=${iso(v.fundingStart)}` +
      ` closeOut=${iso(v.closeOutAt)}  deposits=${(Number(v.totalDeposits.toString()) / 1e6).toLocaleString()}`,
    );
  } catch (e) {
    console.log(`${id.padEnd(16)} — not found / ${(e as Error).message.slice(0, 50)}`);
  }
}
