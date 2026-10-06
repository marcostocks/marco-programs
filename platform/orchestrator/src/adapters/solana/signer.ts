/**
 * The operator's signing key.
 *
 * This key can move customer funds — it is what calls `deploy_buy` and
 * `deploy_capital` — so the kinds are deliberately separate rather than one
 * "load a key from somewhere" function. `file` is for local development only.
 * `kms` and `squads` are the production paths and are unimplemented rather
 * than approximated: a stub that silently signs with something else is worse
 * than one that refuses to start.
 */

import { existsSync, readFileSync } from 'node:fs';

import { Keypair } from '@solana/web3.js';

export type SignerKind = 'mock' | 'file' | 'kms' | 'squads';

export interface LoadSignerOptions {
  readonly kind: SignerKind;
  /** Path to a Solana CLI keypair JSON. Required when kind is `file`. */
  readonly keypairPath?: string | undefined;
}

export function loadOperatorSigner(options: LoadSignerOptions): Keypair {
  switch (options.kind) {
    case 'file': {
      const path = options.keypairPath;
      if (!path) {
        throw new Error('SIGNER_KIND=file requires OPERATOR_KEYPAIR_PATH');
      }
      if (!existsSync(path)) {
        throw new Error(`Operator keypair not found at ${path}`);
      }
      const secret = JSON.parse(readFileSync(path, 'utf8')) as number[];
      if (!Array.isArray(secret) || secret.length !== 64) {
        throw new Error(`${path} is not a 64-byte Solana keypair`);
      }
      return Keypair.fromSecretKey(Uint8Array.from(secret));
    }

    case 'mock':
      throw new Error(
        'SIGNER_KIND=mock cannot sign real transactions. Set SIGNER_KIND=file for localnet.',
      );

    case 'kms':
    case 'squads':
      throw new Error(
        `SIGNER_KIND=${options.kind} is not implemented. Implement it in ` +
          `src/adapters/solana/signer.ts before pointing this service at a real cluster.`,
      );
  }
}
