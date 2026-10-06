/**
 * End-to-end demo: one 10,000 USDC purchase of Tencent, narrated.
 *
 *   npm run demo
 *
 * Runs the real orchestrator against the mock counterparties, stepping each
 * external event by hand so the ordering is visible. Nothing here is test-only
 * scaffolding — it is the same saga, ledger and treasury the service runs in
 * production, with different adapters plugged in underneath.
 */

import { TestClock } from '../src/domain/clock.js';
import { formatMoney, money } from '../src/domain/money.js';
import { testConfig } from '../src/config/config.js';
import { bootstrap } from '../src/bootstrap.js';
import { MemoryStore } from '../src/adapters/store/memory.js';
import { ConsoleLogger } from '../src/support/logger.js';
import { CASH_ACCOUNTS, POSITION_ACCOUNTS } from '../src/ledger/accounts.js';
import { Reconciler } from '../src/recon/reconciler.js';

const WALLET = 'MarcoDemoWa11et111111111111111111111111111';
const TICKER = '0700.HK';

const usdc = (n: bigint) => money('USDC', n);
const hkd = (n: bigint) => money('HKD', n);

function heading(text: string): void {
  process.stdout.write(`\n\x1b[1m${text}\x1b[0m\n${'─'.repeat(text.length)}\n`);
}

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(34)} ${value}\n`);
}

async function main(): Promise<void> {
  const clock = new TestClock('2026-03-02T01:30:00.000Z');
  const store = new MemoryStore(clock);
  const config = testConfig({ logLevel: 'silent' });
  const runtime = bootstrap({
    config,
    clock,
    store,
    logger: new ConsoleLogger('silent'),
  });
  const { services, mocks } = runtime;
  if (!mocks) throw new Error('Demo requires the mock providers');

  const drain = async (): Promise<void> => {
    for (let i = 0; i < 40; i += 1) {
      const result = await runtime.runner.tick();
      if (result.claimed === 0) {
        clock.advance(30_000);
        if ((await runtime.runner.tick()).claimed === 0) return;
      }
      clock.advance(1_000);
    }
  };

  /* ---- Setup ------------------------------------------------------------ */

  heading('0. Opening position');

  mocks.chain.seedMarket({ ticker: TICKER, feeBps: 50 });
  mocks.chain.seedTrader(WALLET, true);
  mocks.compliance.verify(WALLET, 'TIER_2');
  await store.accounts.create({
    wallet: WALLET,
    status: 'ACTIVE',
    verification: null,
    beneficiaryRefs: {},
    suspendedReason: null,
  });

  const openingBuffer = 5_000_000_00n;
  await services.ledger.post({
    reference: 'demo.opening_balances',
    memo: 'Treasury opening balances',
    cash: [
      { account: CASH_ACCOUNTS.BROKER_BUFFER, currency: 'HKD', amount: openingBuffer },
      { account: CASH_ACCOUNTS.FX_CLEARING, currency: 'HKD', amount: -openingBuffer },
    ],
  });
  mocks.broker.seedBuyingPower(hkd(openingBuffer));

  const buffer = await services.treasury.snapshot('HKD');
  line('HKD working buffer', formatMoney(buffer.available));
  line('Trader eligibility (on-chain)', 'registered');
  line('Verification tier', 'TIER_2');

  /* ---- 1. The trader acts ----------------------------------------------- */

  heading('1. Trader places a buy on Solana');

  const escrow = usdc(10_000_000_000n);
  const limit = hkd(365_40n);
  mocks.chain.placeBuy({
    orderId: 'demo-order-1',
    ticker: TICKER,
    trader: WALLET,
    amount: escrow,
    limitPrice: limit,
    quantity: { ticker: TICKER, units: 300n },
  });

  line('USDC escrowed on-chain', formatMoney(escrow));
  line('Limit price', formatMoney(limit));
  line('Shares requested', '300');

  await runtime.watcher.poll();
  const [intent] = await store.intents.list({ kind: 'SPOT_BUY' });
  line('Intent created', intent!.id);

  /* ---- 2. Screen, size, deploy, fund, place ------------------------------ */

  heading('2. Orchestrator screens, sizes, deploys and places');

  await drain();
  let current = (await store.intents.get(intent!.id))!;

  line('Planned quantity', `${current.facts.plannedQuantity?.units ?? 0n} shares`);
  line('Funding path', current.facts.justInTime ? 'just-in-time' : 'working buffer');
  line('Spread earned on-chain', formatMoney(current.facts.spreadEarned!));
  line('Broker order', current.facts.brokerClientOrderId ?? '—');
  line('Buffer available now', formatMoney((await services.treasury.snapshot('HKD')).available));
  line('Intent state', `${current.state} (last step: ${current.stage})`);

  process.stdout.write(
    `\n  The order is at the exchange while the USDC→HKD crossing is still in\n` +
      `  flight. That is the hybrid model: the escrow collateralises the draw.\n`,
  );

  /* ---- 3. The broker fills ---------------------------------------------- */

  heading('3. Broker fills on HKEX');

  const planned = current.facts.plannedQuantity!.units;
  await mocks.broker.fill(current.facts.brokerClientOrderId!, planned, limit);
  await drain();
  current = (await store.intents.get(intent!.id))!;

  line('Filled', `${current.facts.filledQuantity?.units} shares`);
  line('Average price', formatMoney(current.facts.averagePrice!));
  line('Gross consideration', formatMoney(current.facts.grossConsideration!));
  line('Broker commission', formatMoney(current.facts.brokerCommission!));
  line('Exchange levies', formatMoney(current.facts.brokerLevies!));
  line('Position tokens minted', String((await mocks.chain.getMarket(TICKER))!.positionSupply.units));

  process.stdout.write(
    `\n  Still zero tokens. A position is never minted on the strength of a\n` +
      `  payment — only the custodian's confirmation can mint.\n`,
  );

  /* ---- 4. Money settles -------------------------------------------------- */

  heading('4. MSB settles the crossing and wires the broker');

  await mocks.msb.settleConversion(current.facts.conversionRef!);
  await drain();
  current = (await store.intents.get(intent!.id))!;
  await mocks.msb.settlePayout(current.facts.payoutRef!);
  await drain();
  current = (await store.intents.get(intent!.id))!;

  line('Converted', formatMoney(current.facts.convertedAmount!));
  line('MSB fee', formatMoney(current.facts.msbFee!));
  const reservation = await store.reservations.findByIntent(intent!.id);
  line('Buffer reservation', reservation?.state ?? '—');

  /* ---- 5. Custody settles ------------------------------------------------ */

  heading('5. Custodian settles (T+2) and the position mints');

  const tradeRef = current.facts.brokerTradeReference!;
  await mocks.custodian.acknowledgeTrade(
    tradeRef,
    TICKER,
    current.facts.filledQuantity!,
    current.facts.grossConsideration!,
  );
  await drain();
  line('After acknowledgement, tokens', String((await mocks.chain.getMarket(TICKER))!.positionSupply.units));

  await mocks.custodian.settle(tradeRef);
  await drain();
  current = (await store.intents.get(intent!.id))!;

  line('Custody reference', current.facts.custodyReference ?? '—');
  line('Document hash', `${current.facts.documentHash?.slice(0, 24)}…`);
  line('Position tokens minted', String((await mocks.chain.getMarket(TICKER))!.positionSupply.units));
  line('Intent state', current.state);

  /* ---- 6. The books ------------------------------------------------------ */

  heading('6. The books');

  services.ledger.assertBalanced();
  line('Trial balance', 'balanced');
  line(
    'Customer escrow outstanding',
    formatMoney(services.ledger.balance(CASH_ACCOUNTS.CUSTOMER_ESCROW, 'USDC')),
  );
  line(
    'Spread income',
    formatMoney(services.ledger.balance(CASH_ACCOUNTS.INCOME_SPREAD, 'USDC')),
  );
  line(
    'Shares at the custodian',
    String(services.ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTODY_HOLDINGS, TICKER)),
  );
  line(
    'Tokens owed to holders',
    String(-services.ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTOMER_POSITIONS, TICKER)),
  );

  /* ---- 7. Reconciliation ------------------------------------------------- */

  heading('7. Three-way reconciliation');

  const reconciler = new Reconciler(services);
  const clean = await reconciler.run({ tickers: [TICKER] });
  line('Chain vs ledger vs custodian', clean.clean ? 'clean' : `${clean.breaks.length} break(s)`);
  for (const item of clean.breaks) {
    process.stdout.write(`    · [${item.severity}] ${item.scope}: ${item.description}\n`);
  }

  // Now break it deliberately, to show the check has teeth.
  const held = services.ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTODY_HOLDINGS, TICKER);
  mocks.custodian.forcePosition(TICKER, held - 50n);
  const broken = await reconciler.run({ tickers: [TICKER] });
  const backing = broken.breaks.find((b) => b.scope.endsWith(':backing'));
  line('After removing 50 shares from custody', `${broken.breaks.length} break(s)`);
  if (backing) {
    process.stdout.write(`\n  \x1b[31m${backing.severity}\x1b[0m — ${backing.description}\n`);
  }

  process.stdout.write('\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
