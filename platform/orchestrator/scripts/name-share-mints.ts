/**
 * Give each vault's claim-token mint a Metaplex name and symbol, so a wallet
 * shows "marcoMoonshotAI token" instead of a bare mint address.
 *
 *   npx tsx scripts/name-share-mints.ts              # all of them
 *   VAULTS=red-2026 npx tsx scripts/name-share-mints.ts   # just one
 *
 * This has to go through the program: the mint authority is the vault PDA, and
 * a PDA can only sign via CPI from the program that owns it. No off-chain key
 * can create this metadata however much authority it holds.
 *
 * Idempotent by inspection rather than by on-chain flag — a vault whose mint
 * already has metadata is skipped, so re-running is safe and cheap. Nothing
 * here writes vault state; `create_share_metadata` takes the vault account
 * immutably.
 */
import { readFileSync } from 'node:fs';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';

import { loadArtifacts } from '../src/adapters/solana/artifacts.js';

/** Metaplex Token Metadata, same address on every cluster. */
const TOKEN_METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

/**
 * name / symbol per vault. Metaplex caps name at 32 characters and symbol at
 * 10; both are checked by the program before the CPI, and again here so a bad
 * entry fails before it costs a transaction.
 *
 * The symbols match what the pages already call these tokens (m + ticker).
 */
const NAMES: Record<string, { name: string; symbol: string }> = {
  'moon-2026-s': { name: 'marcoMoonshotAI token', symbol: 'mMOON' },
  'unitree-2026-s': { name: 'marcoUnitree token', symbol: 'mUNI' },
  'red-2026': { name: 'marcoXiaohong token', symbol: 'mRED' },
  'byte-2026-r': { name: 'marcoByteDance token', symbol: 'mBYTE' },
  'byte-2026-s': { name: 'marcoByteDance token', symbol: 'mBYTE' },
  'byte-2026-l': { name: 'marcoByteDance token', symbol: 'mBYTE' },
};

/**
 * No off-chain JSON yet, so no logo — a wallet will show the name and symbol
 * and a blank icon. The metadata is created mutable, so pointing this at a
 * hosted JSON later is an ordinary Metaplex update, not a program change.
 */
const URI = '';

const keypair = (path: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME ?? ''), 'utf8'))),
  );

async function main(): Promise<void> {
  const artifacts = loadArtifacts();
  const admin = keypair(process.env.ADMIN_KEYPAIR ?? '~/.config/solana/id.json');
  const connection = new Connection(artifacts.addresses.rpcUrl, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' });
  // The IDL is loaded at runtime, so Anchor's generated method types are not
  // available here — this names the one method this script calls rather than
  // indexing a Record, which typechecks as possibly-undefined.
  const program = new Program(artifacts.vaultIdl as never, provider) as unknown as {
    methods: {
      createShareMetadata: (name: string, symbol: string, uri: string) => {
        accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
      };
    };
  };

  const wanted = (process.env.VAULTS ?? Object.keys(NAMES).join(',')).split(',').map((s) => s.trim());

  for (const vaultId of wanted) {
    const meta = NAMES[vaultId];
    if (!meta) {
      console.log(`${vaultId.padEnd(16)} no name configured — skipped`);
      continue;
    }
    if (meta.name.length > 32 || meta.symbol.length > 10) {
      throw new Error(`${vaultId}: name/symbol over the Metaplex limit (32/10)`);
    }

    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), admin.publicKey.toBuffer(), Buffer.from(vaultId)],
      artifacts.vaultProgramId,
    );
    const [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from('share_mint'), vault.toBuffer()],
      artifacts.vaultProgramId,
    );
    const [metadata] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TOKEN_METADATA.toBuffer(), shareMint.toBuffer()],
      TOKEN_METADATA,
    );

    if (!(await connection.getAccountInfo(vault))) {
      console.log(`${vaultId.padEnd(16)} no vault on this cluster — skipped`);
      continue;
    }
    if (await connection.getAccountInfo(metadata)) {
      console.log(`${vaultId.padEnd(16)} already named — skipped`);
      continue;
    }

    const sig = await program.methods
      .createShareMetadata(meta.name, meta.symbol, URI)
      .accounts({
        vault,
        shareMint,
        metadata,
        admin: admin.publicKey,
        tokenMetadataProgram: TOKEN_METADATA,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log(`${vaultId.padEnd(16)} ${meta.symbol.padEnd(6)} ${meta.name.padEnd(22)} ${sig}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
