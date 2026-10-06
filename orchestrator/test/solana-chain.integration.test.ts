/**
 * `SolanaChain` against a real validator.
 *
 * The unit suite runs entirely on `MockChain`, so nothing in it can catch the
 * failures that actually matter here: a mistyped account name, a PDA seed that
 * drifted from the program, an event the parser cannot decode, or a write that
 * is not idempotent. All four are invisible until a transaction is submitted.
 *
 * Skips itself when no validator is listening, so `npm test` stays runnable
 * without one. Start it with `sh scripts/localnet.sh`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BN, Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { SolanaChain } from '../src/adapters/solana/chain.js';
import { loadArtifacts, type MarcoArtifacts } from '../src/adapters/solana/artifacts.js';
import { buyerStatePda, shareMintPda, vaultPda } from '../src/adapters/solana/pdas.js';
import type { MarcoVault } from '../src/adapters/solana/generated/marco_vault.js';
import { systemClock } from '../src/domain/clock.js';
import { money } from '../src/domain/money.js';
import { ConsoleLogger } from '../src/support/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS = join(HERE, '..', '..', '.localnet', 'keys');
const RPC_URL = 'http://127.0.0.1:8899';

const USDC = (n: number) => BigInt(Math.round(n * 1e6));
const usdc = (n: number) => money('USDC', USDC(n));

const keypair = (name: string): Keypair =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(KEYS, `${name}.json`), 'utf8')) as number[]),
  );

async function validatorIsUp(): Promise<boolean> {
  try {
    await new Connection(RPC_URL, 'confirmed').getVersion();
    return true;
  } catch {
    return false;
  }
}

const up = await validatorIsUp();

// This suite is localnet-only: it hardcodes the localhost RPC and signs with
// the .localnet/keys wallets. When the shared artifacts point at another
// cluster (e.g. after `npm run setup:devnet`), the localhost validator and the
// artifacts' mint/admin no longer match, so skip rather than fail — the live
// checks belong against the cluster the artifacts actually describe.
const clusterIsLocal = (() => {
  try {
    return loadArtifacts().addresses.cluster === 'localnet';
  } catch {
    return false;
  }
})();

describe.skipIf(!up || !clusterIsLocal)('SolanaChain against a live validator', () => {
  let chain: SolanaChain;
  let artifacts: MarcoArtifacts;
  let conn: Connection;
  let admin: Keypair;
  let depositor: Keypair;
  let vaultId: string;

  beforeAll(async () => {
    artifacts = loadArtifacts();
    conn = new Connection(RPC_URL, 'confirmed');
    admin = keypair('admin');
    depositor = keypair('demo-trader');

    chain = new SolanaChain({
      clock: systemClock,
      logger: new ConsoleLogger('error'),
      rpcUrl: RPC_URL,
      operator: keypair('operator'),
      admin,
      artifacts,
    });

    // A fresh id per run keeps repeated runs independent without a validator
    // reset. The slot is monotonic, so it is a safe discriminator.
    vaultId = `it-vault-${await conn.getSlot()}`;
  });

  it('creates a vault, and creating it again is a no-op', async () => {
    const now = Date.now();
    const params = {
      vaultId,
      depositCap: usdc(1_000_000),
      minDeposit: usdc(100),
      maxDeposit: usdc(0),
      // Well in the past: the program checks against the validator's clock,
      // which lags wall-clock on a local node.
      fundingStart: new Date(now - 3_600_000).toISOString(),
      fundingDeadline: new Date(now + 86_400_000).toISOString(),
      closeOutAt: new Date(now + 30 * 86_400_000).toISOString(),
      feeBps: 500,
      depositDestination: artifacts.addresses.tokenAccounts.brokerUsdc,
      treasury: artifacts.addresses.wallets.treasury,
    };

    const created = await chain.initializeVault(params);
    expect(created.alreadyApplied).toBe(false);
    expect(created.signature).not.toBe('');

    const state = await chain.getVault(vaultId);
    expect(state).not.toBeNull();
    expect(state!.phase).toBe('Scheduled');
    expect(state!.cap.amount).toBe(USDC(1_000_000));
    expect(state!.feeBps).toBe(500);
    // The destination fixed at creation is the one thing that can never be
    // corrected, so it is asserted rather than assumed.
    expect(state!.brokerDestination).toBe(artifacts.addresses.tokenAccounts.brokerUsdc);

    // Idempotency: the contract every write in this adapter has to honour.
    const again = await chain.initializeVault(params);
    expect(again.alreadyApplied).toBe(true);
  });

  it('opens funding, and re-opening is a no-op', async () => {
    const opened = await chain.openFunding(vaultId);
    expect(opened.alreadyApplied).toBe(false);
    expect((await chain.getVault(vaultId))!.phase).toBe('Funding');

    const again = await chain.openFunding(vaultId);
    expect(again.alreadyApplied).toBe(true);
  });

  it('decodes a holder deposit from the transaction log', async () => {
    const vault = vaultPda(artifacts.vaultProgramId, admin.publicKey, vaultId);
    const shareMint = shareMintPda(artifacts.vaultProgramId, vault);

    // Deposit is holder-signed — the orchestrator never signs for a trader.
    const provider = new AnchorProvider(conn, new Wallet(depositor), {
      commitment: 'confirmed',
    });
    const program = new Program<MarcoVault>(
      artifacts.vaultIdl as unknown as MarcoVault,
      provider,
    );

    const depositorShares = await createAssociatedTokenAccount(
      conn,
      depositor,
      shareMint,
      depositor.publicKey,
    );
    const vaultUsdc = await getAssociatedTokenAddress(artifacts.usdcMint, vault, true);

    const before = await chain.pollEvents({ lastSignature: null, lastSlot: 0 }, 100);

    await program.methods
      .deposit(new BN(USDC(10_000).toString()))
      .accountsPartial({
        vault,
        buyerState: buyerStatePda(artifacts.vaultProgramId, vault, depositor.publicKey),
        shareMint,
        depositorUsdc: new PublicKey(artifacts.addresses.tokenAccounts.demoTraderUsdc),
        vaultUsdc,
        depositorShares,
        depositor: depositor.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([depositor])
      .rpc();

    // 10,000 gross - 5% = 9,500 subscribed, minted 1:1.
    const shares = await getAccount(conn, depositorShares);
    expect(shares.amount).toBe(USDC(9_500));

    const page = await chain.pollEvents(before.cursor, 100);
    const deposits = page.events.filter((e) => e.kind === 'vault.deposit');
    expect(deposits.length).toBeGreaterThan(0);

    const event = deposits.find((e) => e.vaultId === vaultId);
    expect(event, 'the deposit event must decode off the log').toBeDefined();
    expect(event!.wallet).toBe(depositor.publicKey.toBase58());
    // Gross, matching what left the wallet — not the net that was minted.
    expect(event!.amount!.amount).toBe(USDC(10_000));
    expect(event!.shares!.units).toBe(USDC(9_500));
    expect(page.cursor.lastSlot).toBeGreaterThanOrEqual(before.cursor.lastSlot);

    const state = await chain.getVault(vaultId);
    expect(state!.totalDeposits.amount).toBe(USDC(10_000));
    expect(state!.totalShares).toBe(USDC(9_500));
    // Held, not earned — refundable until capital deploys.
    expect(state!.feesEscrowed.amount).toBe(USDC(500));
  });

  it('refuses a transition from the wrong phase', async () => {
    // Funding, not Sourced. The adapter should reject before submitting.
    await expect(chain.deployCapital(vaultId, usdc(1_000))).rejects.toThrow(/expected Sourced/);
  });

  it('reads a market that does not exist as null, not an error', async () => {
    expect(await chain.getMarket('no-such-ticker')).toBeNull();
    expect(await chain.getVault('no-such-vault')).toBeNull();
  });
});
