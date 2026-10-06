/**
 * Subscribe test USDC into a vault until it reaches a target fill.
 *
 *   VAULT_ID=moon-2026-s PCT=85 npx tsx scripts/fill-vault-devnet.ts
 *
 * The page reads `total_deposits` from the program, so a card cannot be made to
 * look subscribed without actually subscribing. This does that properly: each
 * tranche is a distinct generated wallet signing its own `deposit`, which is
 * also what makes the activity ticker show several depositors rather than one.
 *
 * Everything here is devnet test USDC minted by the admin, which is the mint
 * authority. It has no value and settles nothing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const artifacts = JSON.parse(
  readFileSync(join(ROOT, 'shared', 'marco-artifacts', 'addresses.json'), 'utf8'),
);
const idl = JSON.parse(
  readFileSync(join(ROOT, 'shared', 'marco-artifacts', 'idl', 'marco_vault.json'), 'utf8'),
);

const VAULT_ID = process.env.VAULT_ID ?? 'moon-2026-s';
const PCT = Number(process.env.PCT ?? 85);
/** How many wallets to split the fill across. More is prettier in the ticker
 *  and more transactions against an RPC that rate-limits. */
const TRANCHES = Number(process.env.TRANCHES ?? 3);

const loadKey = (p: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(p.replace(/^~/, process.env.HOME ?? ''), 'utf8'))),
  );

const enc = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const admin = loadKey(process.env.ADMIN_KEYPAIR ?? '~/.config/solana/id.json');
  const connection = new Connection(artifacts.rpcUrl, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' });
  // The IDL is loaded as JSON at runtime, so Anchor's generic resolves to the
  // untyped `Idl`. The account and method namespaces are reached through a cast
  // rather than pretending a generated type is in play.
  const program = new Program(idl, provider) as any;

  const PROG = new PublicKey(artifacts.programs.marcoVault);
  const USDC = new PublicKey(artifacts.usdc.mint);
  // Same seeds as src/chain/index.js and the orchestrator's pdas.ts.
  const [vault] = PublicKey.findProgramAddressSync(
    [enc('vault'), admin.publicKey.toBuffer(), enc(VAULT_ID)],
    PROG,
  );
  const [shareMint] = PublicKey.findProgramAddressSync([enc('share_mint'), vault.toBuffer()], PROG);
  const vaultUsdc = await getAssociatedTokenAddress(USDC, vault, true);

  const v0 = await program.account.vault.fetch(vault);
  const cap = Number(v0.depositCap) / 1e6;
  const already = Number(v0.totalDeposits) / 1e6;
  const target = (cap * PCT) / 100;
  const need = target - already;

  console.log(`${VAULT_ID}: cap ${cap.toLocaleString()} · already ${already.toLocaleString()} · target ${PCT}%`);
  if (need <= 0) return console.log('  already at or past the target, nothing to do');

  // Uneven tranches read like real subscriptions rather than a script.
  const weights: number[] = [0.52, 0.31, 0.17, 0.24, 0.13].slice(0, TRANCHES);
  const sum = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map((w) => Math.round((need * w) / sum));
  amounts[amounts.length - 1] = (amounts[amounts.length - 1] ?? 0) + Math.round(need - amounts.reduce((a, b) => a + b, 0));

  for (const [i, amount] of amounts.entries()) {
    if (amount <= 0) continue;
    const buyer = Keypair.generate();
    console.log(`\n  tranche ${i + 1}/${amounts.length} · ${amount.toLocaleString()} USDC · ${buyer.publicKey.toBase58().slice(0, 8)}…`);

    await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: buyer.publicKey,
          lamports: 0.02 * LAMPORTS_PER_SOL,
        }),
      ),
    );
    await sleep(400);

    const buyerUsdc = await getOrCreateAssociatedTokenAccount(connection, admin, USDC, buyer.publicKey);
    await sleep(400);
    await mintTo(connection, admin, USDC, buyerUsdc.address, admin, BigInt(amount) * 1_000_000n);
    await sleep(400);
    // The deposit instruction does not create the claim-token account.
    const buyerShares = await getOrCreateAssociatedTokenAccount(connection, admin, shareMint, buyer.publicKey);
    await sleep(400);

    const [buyerState] = PublicKey.findProgramAddressSync(
      [enc('buyer'), vault.toBuffer(), buyer.publicKey.toBuffer()],
      PROG,
    );
    const sig = await program.methods
      .deposit(new BN(amount).mul(new BN(1_000_000)))
      .accountsPartial({
        vault,
        buyerState,
        shareMint,
        depositorUsdc: buyerUsdc.address,
        vaultUsdc,
        depositorShares: buyerShares.address,
        depositor: buyer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    console.log(`    deposited · ${sig.slice(0, 24)}…`);
    await sleep(700);
  }

  const v1 = await program.account.vault.fetch(vault);
  const raised = Number(v1.totalDeposits) / 1e6;
  const shares = Number(v1.totalShares) / 1e6;
  console.log(
    `\n  ${VAULT_ID}: ${raised.toLocaleString()} / ${cap.toLocaleString()} USDC ` +
      `= ${((raised / cap) * 100).toFixed(1)}% · ${shares.toLocaleString()} claim tokens ` +
      `(${(shares / raised).toFixed(3)} per USDC)`,
  );
  const bal = Number((await getAccount(connection, vaultUsdc)).amount) / 1e6;
  console.log(`  vault USDC balance: ${bal.toLocaleString()}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
