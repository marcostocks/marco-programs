/**
 * Runtime configuration.
 *
 * Loaded once at boot and validated hard: a missing webhook secret or a
 * malformed treasury threshold should stop the process, not surface later as a
 * silently skipped signature check.
 */

import { z } from 'zod';
import { money, type Money } from '../domain/money.js';
import type { TreasuryPolicy } from '../treasury/treasury.js';
import type { RunnerPolicy } from '../orchestration/runner.js';
import type { LogLevel } from '../support/logger.js';

const providerKind = z.enum(['mock', 'http', 'solana']);

const bigintString = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer of minor units')
  .transform((value) => BigInt(value));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  PORT: z.coerce.number().int().positive().default(8080),

  OPERATOR_API_TOKENS: z.string().min(1),

  MSB_PROVIDER: providerKind.default('mock'),
  BROKER_PROVIDER: providerKind.default('mock'),
  CUSTODIAN_PROVIDER: providerKind.default('mock'),
  CHAIN_PROVIDER: providerKind.default('mock'),
  COMPLIANCE_PROVIDER: providerKind.default('mock'),

  MSB_WEBHOOK_SECRET: z.string().min(8),
  BROKER_WEBHOOK_SECRET: z.string().min(8),
  CUSTODIAN_WEBHOOK_SECRET: z.string().min(8),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

  TREASURY_HKD_TARGET: bigintString,
  TREASURY_HKD_MINIMUM: bigintString,
  TREASURY_HKD_TOPUP_INCREMENT: bigintString,
  TREASURY_USDC_TARGET: bigintString,
  TREASURY_USDC_MINIMUM: bigintString,
  TREASURY_MAX_SINGLE_RESERVATION_HKD: bigintString,

  SOLANA_RPC_URL: z.string().url().optional(),
  SPOT_PROGRAM_ID: z.string().optional(),
  VAULT_PROGRAM_ID: z.string().optional(),
  SIGNER_KIND: z.enum(['mock', 'file', 'kms', 'squads']).default('mock'),
  OPERATOR_KEYPAIR_PATH: z.string().optional(),
  ADMIN_KEYPAIR_PATH: z.string().optional(),

  RUNNER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  RUNNER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  RUNNER_BASE_BACKOFF_MS: z.coerce.number().int().positive().default(500),

  BROKER_ACCOUNT_REF: z.string().default('MARCO-OMNIBUS-01'),
  CUSTODY_ACCOUNT_REF: z.string().default('MARCO-CUSTODY-01'),
});

export type ProviderKind = z.infer<typeof providerKind>;

export interface WebhookConfig {
  readonly msbSecret: string;
  readonly brokerSecret: string;
  readonly custodianSecret: string;
  readonly toleranceSeconds: number;
}

export interface Config {
  readonly env: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly port: number;
  readonly operatorTokens: readonly string[];
  readonly providers: {
    readonly msb: ProviderKind;
    readonly broker: ProviderKind;
    readonly custodian: ProviderKind;
    readonly chain: ProviderKind;
    readonly compliance: ProviderKind;
  };
  readonly webhooks: WebhookConfig;
  readonly treasury: TreasuryPolicy;
  readonly runner: RunnerPolicy;
  readonly solana: {
    readonly rpcUrl: string | null;
    readonly spotProgramId: string | null;
    readonly vaultProgramId: string | null;
    readonly signerKind: 'mock' | 'file' | 'kms' | 'squads';
    readonly operatorKeypairPath: string | null;
    readonly adminKeypairPath: string | null;
  };
  readonly accounts: {
    readonly brokerRef: string;
    readonly custodyRef: string;
  };
  /**
   * Trading spread charged in-contract, in basis points. Mirrors `fee_bps` on
   * the market; the on-chain value is authoritative and this is used only to
   * predict funding needs before a market read.
   */
  readonly defaultSpreadBps: number;
  /** Headroom added to a funding reservation to absorb commission and slippage. */
  readonly fundingHeadroomBps: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const env = parsed.data;

  const hkd = (amount: bigint): Money => money('HKD', amount);
  const usdc = (amount: bigint): Money => money('USDC', amount);

  return {
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
    operatorTokens: env.OPERATOR_API_TOKENS.split(',')
      .map((token) => token.trim())
      .filter(Boolean),
    providers: {
      msb: env.MSB_PROVIDER,
      broker: env.BROKER_PROVIDER,
      custodian: env.CUSTODIAN_PROVIDER,
      chain: env.CHAIN_PROVIDER,
      compliance: env.COMPLIANCE_PROVIDER,
    },
    webhooks: {
      msbSecret: env.MSB_WEBHOOK_SECRET,
      brokerSecret: env.BROKER_WEBHOOK_SECRET,
      custodianSecret: env.CUSTODIAN_WEBHOOK_SECRET,
      toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
    },
    treasury: {
      hkd: {
        target: hkd(env.TREASURY_HKD_TARGET),
        minimum: hkd(env.TREASURY_HKD_MINIMUM),
        increment: hkd(env.TREASURY_HKD_TOPUP_INCREMENT),
        maxSingleReservation: hkd(env.TREASURY_MAX_SINGLE_RESERVATION_HKD),
      },
      usdc: {
        target: usdc(env.TREASURY_USDC_TARGET),
        minimum: usdc(env.TREASURY_USDC_MINIMUM),
        increment: usdc(env.TREASURY_USDC_TARGET / 2n),
        maxSingleReservation: usdc(env.TREASURY_USDC_MINIMUM),
      },
      reservationTtlSeconds: 6 * 60 * 60,
    },
    runner: {
      maxAttempts: env.RUNNER_MAX_ATTEMPTS,
      baseBackoffMillis: env.RUNNER_BASE_BACKOFF_MS,
      maxBackoffMillis: 5 * 60 * 1000,
      waitPollMillis: 15 * 1000,
      leaseMillis: 60 * 1000,
      batchSize: 25,
    },
    solana: {
      rpcUrl: env.SOLANA_RPC_URL ?? null,
      spotProgramId: env.SPOT_PROGRAM_ID ?? null,
      vaultProgramId: env.VAULT_PROGRAM_ID ?? null,
      signerKind: env.SIGNER_KIND,
      operatorKeypairPath: env.OPERATOR_KEYPAIR_PATH ?? null,
      adminKeypairPath: env.ADMIN_KEYPAIR_PATH ?? null,
    },
    accounts: {
      brokerRef: env.BROKER_ACCOUNT_REF,
      custodyRef: env.CUSTODY_ACCOUNT_REF,
    },
    defaultSpreadBps: 50,
    fundingHeadroomBps: 75,
  };
}

/** Config for tests and the demo script — no environment required. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    env: 'test',
    logLevel: 'silent',
    port: 0,
    operatorTokens: ['test-token'],
    providers: {
      msb: 'mock',
      broker: 'mock',
      custodian: 'mock',
      chain: 'mock',
      compliance: 'mock',
    },
    webhooks: {
      msbSecret: 'test-msb-secret',
      brokerSecret: 'test-broker-secret',
      custodianSecret: 'test-custodian-secret',
      toleranceSeconds: 300,
    },
    treasury: {
      hkd: {
        target: money('HKD', 500_000_00n),
        minimum: money('HKD', 150_000_00n),
        increment: money('HKD', 250_000_00n),
        maxSingleReservation: money('HKD', 1_000_000_00n),
      },
      usdc: {
        target: money('USDC', 500_000_000_000n),
        minimum: money('USDC', 150_000_000_000n),
        increment: money('USDC', 250_000_000_000n),
        maxSingleReservation: money('USDC', 250_000_000_000n),
      },
      reservationTtlSeconds: 6 * 60 * 60,
    },
    runner: {
      maxAttempts: 4,
      baseBackoffMillis: 10,
      maxBackoffMillis: 1000,
      waitPollMillis: 10,
      leaseMillis: 1000,
      batchSize: 25,
    },
    solana: {
      rpcUrl: null,
      spotProgramId: '44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e',
      vaultProgramId: null,
      signerKind: 'mock',
      operatorKeypairPath: null,
      adminKeypairPath: null,
    },
    accounts: { brokerRef: 'MARCO-OMNIBUS-01', custodyRef: 'MARCO-CUSTODY-01' },
    defaultSpreadBps: 50,
    fundingHeadroomBps: 75,
    ...overrides,
  };
}
