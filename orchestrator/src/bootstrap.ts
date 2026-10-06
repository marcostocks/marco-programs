/**
 * Composition root.
 *
 * The only place that decides which concrete adapter backs each port. Nothing
 * else in the service imports an adapter, which is what makes swapping a
 * counterparty a one-line change here rather than an archaeology exercise.
 */

import { systemClock, type Clock } from './domain/clock.js';
import type { Config } from './config/config.js';
import { Ledger, InMemoryJournalStore } from './ledger/ledger.js';
import { MemoryStore } from './adapters/store/memory.js';
import { MockBroker } from './adapters/mock/broker.js';
import { MockChain } from './adapters/mock/chain.js';
import { MockCompliance } from './adapters/mock/compliance.js';
import { MockCustodian } from './adapters/mock/custodian.js';
import { MockMsb } from './adapters/mock/msb.js';
import { SolanaChain } from './adapters/solana/chain.js';
import { loadOperatorSigner } from './adapters/solana/signer.js';
import type { ChainGateway } from './ports/chain.js';
import type { ProviderKind } from './config/config.js';
import { SagaRunner, type Saga } from './orchestration/runner.js';
import { spotBuySaga } from './orchestration/sagas/spot-buy.js';
import { spotSellSaga } from './orchestration/sagas/spot-sell.js';
import {
  vaultDeliverySaga,
  vaultRedeemSaga,
  vaultSubscribeSaga,
} from './orchestration/sagas/vault-intents.js';
import { VaultDriver } from './orchestration/vault-driver.js';
import { ChainWatcher } from './orchestration/watcher.js';
import { Treasury } from './treasury/treasury.js';
import type { Services } from './services.js';
import { ConsoleLogger, type Logger } from './support/logger.js';
import type { Store } from './ports/store.js';

export interface Runtime {
  readonly services: Services;
  readonly runner: SagaRunner<Services>;
  readonly watcher: ChainWatcher;
  readonly vaultDriver: VaultDriver;
  /** Concrete mocks, exposed only when the mock providers are selected. */
  readonly mocks: {
    readonly msb: MockMsb;
    readonly broker: MockBroker;
    readonly custodian: MockCustodian;
    readonly chain: MockChain;
    readonly compliance: MockCompliance;
  } | null;
}

export interface BootstrapOptions {
  readonly config: Config;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly store?: Store;
}

export const ALL_SAGAS: readonly Saga<Services>[] = [
  spotBuySaga,
  spotSellSaga,
  vaultSubscribeSaga,
  vaultRedeemSaga,
  vaultDeliverySaga,
];

export function bootstrap(options: BootstrapOptions): Runtime {
  const { config } = options;
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? new ConsoleLogger(config.logLevel);
  const store = options.store ?? new MemoryStore(clock);

  const ledger = new Ledger({ store: new InMemoryJournalStore(), clock });
  const treasury = new Treasury({
    ledger,
    reservations: store.reservations,
    policy: config.treasury,
    clock,
  });

  // A partially real configuration is the most dangerous state this service
  // can be in, so each port is checked against what is actually implemented
  // rather than requiring all-or-nothing.
  //
  // `chain: 'solana'` alongside mock counterparties is deliberately allowed:
  // that combination is the localnet demo, and it is safe because the mocks
  // move no real money while the chain writes are all reversible on a local
  // validator. Any *other* non-mock provider still refuses to start.
  const unimplemented: [string, ProviderKind][] = (
    [
      ['msb', config.providers.msb, ['mock']],
      ['broker', config.providers.broker, ['mock']],
      ['custodian', config.providers.custodian, ['mock']],
      ['compliance', config.providers.compliance, ['mock']],
      ['chain', config.providers.chain, ['mock', 'solana']],
    ] satisfies [string, ProviderKind, ProviderKind[]][]
  )
    .filter(([, selected, supported]) => !(supported as ProviderKind[]).includes(selected))
    .map(([port, selected]) => [port, selected]);

  if (unimplemented.length > 0) {
    throw new Error(
      `No adapter is implemented for: ${unimplemented
        .map(([port, selected]) => `${port}=${selected}`)
        .join(', ')}. Wire it in bootstrap.ts and add it to the supported list ` +
        `once its integration tests pass against the counterparty sandbox.`,
    );
  }

  const usingMocks = config.providers.chain === 'mock';

  const msb = new MockMsb({ clock, webhookSecret: config.webhooks.msbSecret });
  const broker = new MockBroker({ clock, webhookSecret: config.webhooks.brokerSecret });
  const custodian = new MockCustodian({
    clock,
    webhookSecret: config.webhooks.custodianSecret,
    accountRef: config.accounts.custodyRef,
  });
  const mockChain = usingMocks ? new MockChain({ clock }) : null;
  const chain: ChainGateway = mockChain ?? buildSolanaChain(config, clock, logger);
  const compliance = new MockCompliance({ clock });

  // Close the loop between the two simulations: a settled bank payout at the
  // MSB is buying power at the broker. Without this the mocks disagree about
  // cash and reconciliation reports a break that is an artefact of the
  // simulation rather than a real discrepancy.
  msb.onBankPayoutSettled = (payout) => broker.receiveFunds(payout.amount);

  const services: Services = {
    config,
    clock,
    logger,
    store,
    ledger,
    treasury,
    msb,
    broker,
    custodian,
    chain,
    compliance,
  };

  const runner = new SagaRunner<Services>({
    sagas: ALL_SAGAS,
    services,
    store,
    clock,
    logger,
    policy: config.runner,
  });

  return {
    services,
    runner,
    watcher: new ChainWatcher(services),
    vaultDriver: new VaultDriver(services),
    mocks: mockChain ? { msb, broker, custodian, chain: mockChain, compliance } : null,
  };
}

/**
 * The real chain gateway needs two keys, not one.
 *
 * Most vault phase transitions require the *admin* as signer; only
 * `deploy_capital`, `deploy_buy`, `confirm_buy` and `settle_sell` accept the
 * operator. A service holding only the operator key cannot advance a deal past
 * funding, so both are loaded here and the failure to supply either is fatal
 * at startup rather than halfway through a lifecycle.
 */
function buildSolanaChain(config: Config, clock: Clock, logger: Logger): ChainGateway {
  const { rpcUrl, signerKind, operatorKeypairPath, adminKeypairPath } = config.solana;
  if (!rpcUrl) throw new Error('CHAIN_PROVIDER=solana requires SOLANA_RPC_URL');

  return new SolanaChain({
    clock,
    logger,
    rpcUrl,
    operator: loadOperatorSigner({ kind: signerKind, keypairPath: operatorKeypairPath ?? undefined }),
    admin: loadOperatorSigner({ kind: signerKind, keypairPath: adminKeypairPath ?? undefined }),
  });
}
