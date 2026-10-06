/** Simulate a deposit into moon-2026-s and confirm the FundingClosed gate is gone. */
import { readFileSync } from 'node:fs';
import {
  Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const ROOT = '/Users/tonytran/Documents/Claude/Projects/Marco';
const addresses = JSON.parse(readFileSync(`${ROOT}/shared/marco-artifacts/addresses.json`, 'utf8'));
const idl = JSON.parse(readFileSync(`${ROOT}/shared/marco-artifacts/idl/marco_vault.json`, 'utf8'));
const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf8')) as number[]),
);
const programId = new PublicKey(addresses.programs.marcoVault);
const adminPk = new PublicKey(addresses.wallets.admin);
const USDC = new PublicKey(addresses.usdc.mint);
const conn = new Connection(addresses.rpcUrl, 'confirmed');
const program: any = new Program(idl, new AnchorProvider(conn, new Wallet(admin), { commitment: 'confirmed' }));

const enc = (s: string) => Buffer.from(s);
const vaultPda = (id: string) =>
  PublicKey.findProgramAddressSync([enc('vault'), adminPk.toBuffer(), enc(id)], programId)[0];
const shareMintPda = (v: PublicKey) => PublicKey.findProgramAddressSync([enc('share_mint'), v.toBuffer()], programId)[0];
const buyerPda = (v: PublicKey, d: PublicKey) =>
  PublicKey.findProgramAddressSync([enc('buyer'), v.toBuffer(), d.toBuffer()], programId)[0];

async function main() {
  const id = 'moon-2026-s';
  const vault = vaultPda(id);
  const shareMint = shareMintPda(vault);
  const ix = await program.methods
    .deposit(new BN(1_000_000)) // 1 USDC — depositor = admin (may hold no USDC; that's a LATER check)
    .accountsPartial({
      vault,
      buyerState: buyerPda(vault, adminPk),
      shareMint,
      depositorUsdc: getAssociatedTokenAddressSync(USDC, adminPk),
      vaultUsdc: getAssociatedTokenAddressSync(USDC, vault, true),
      depositorShares: getAssociatedTokenAddressSync(shareMint, adminPk),
      depositor: adminPk,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: adminPk, recentBlockhash: blockhash, instructions: [ix] })
    .compileToV0Message();
  const sim = await conn.simulateTransaction(new VersionedTransaction(msg), {
    sigVerify: false, replaceRecentBlockhash: true,
  });

  const logs = sim.value.logs ?? [];
  const fundingClosed = logs.some((l) => /FundingClosed|window has closed/i.test(l));
  const passedFundingGate = logs.some((l) => /Instruction: Deposit/i.test(l)) && !fundingClosed;
  console.log('err:', JSON.stringify(sim.value.err));
  console.log('FundingClosed present:', fundingClosed);
  console.log('passed the funding-deadline gate:', passedFundingGate ? 'YES' : 'no');
  console.log('--- program logs ---');
  logs.filter((l) => /Program log|Error|failed/i.test(l)).slice(0, 12).forEach((l) => console.log(l));
}
main().catch((e) => { console.error(e); process.exit(1); });
