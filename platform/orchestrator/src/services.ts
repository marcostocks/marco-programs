/**
 * The service container handed to every saga step.
 *
 * Assembled once at boot from the configured adapters. Steps take it as an
 * argument rather than importing modules directly, which is what lets the whole
 * pipeline run against mocks in a test and against real counterparties in
 * production without a single change to saga code.
 */

import type { Clock } from './domain/clock.js';
import type { Ledger } from './ledger/ledger.js';
import type { ChainGateway } from './ports/chain.js';
import type { ComplianceProvider } from './ports/compliance.js';
import type { Custodian } from './ports/custodian.js';
import type { ExecutingBroker } from './ports/broker.js';
import type { MoneyServicesProvider } from './ports/msb.js';
import type { Store } from './ports/store.js';
import type { Treasury } from './treasury/treasury.js';
import type { Logger } from './support/logger.js';
import type { Config } from './config/config.js';

export interface Services {
  readonly config: Config;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly store: Store;
  readonly ledger: Ledger;
  readonly treasury: Treasury;
  readonly msb: MoneyServicesProvider;
  readonly broker: ExecutingBroker;
  readonly custodian: Custodian;
  readonly chain: ChainGateway;
  readonly compliance: ComplianceProvider;
}
