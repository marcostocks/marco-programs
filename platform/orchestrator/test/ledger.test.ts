import { describe, expect, it } from 'vitest';
import { TestClock } from '../src/domain/clock.js';
import { money, parseMoney } from '../src/domain/money.js';
import { CASH_ACCOUNTS, POSITION_ACCOUNTS } from '../src/ledger/accounts.js';
import { Ledger } from '../src/ledger/ledger.js';
import * as postings from '../src/ledger/postings.js';

function newLedger(): Ledger {
  return new Ledger({ clock: new TestClock() });
}

const usdc = (amount: bigint) => money('USDC', amount);
const hkd = (amount: bigint) => money('HKD', amount);
const shares = (units: bigint) => ({ ticker: '0700.HK', units });

describe('ledger', () => {
  it('rejects an unbalanced entry rather than repairing it', async () => {
    const ledger = newLedger();
    await expect(
      ledger.post({
        reference: 'test.unbalanced',
        memo: 'deliberately wrong',
        cash: [
          { account: CASH_ACCOUNTS.CHAIN_ESCROW, currency: 'USDC', amount: 100n },
          { account: CASH_ACCOUNTS.CUSTOMER_ESCROW, currency: 'USDC', amount: -99n },
        ],
      }),
    ).rejects.toThrow(/do not balance in USDC/);
  });

  it('rejects an entry with no postings', async () => {
    const ledger = newLedger();
    await expect(ledger.post({ reference: 'test.empty', memo: '' })).rejects.toThrow(
      /no non-zero postings/,
    );
  });

  it('balances each currency independently', async () => {
    const ledger = newLedger();
    await ledger.post({
      reference: 'test.multi',
      memo: 'cross-currency',
      cash: [
        { account: CASH_ACCOUNTS.MSB_TRANSIT, currency: 'USDC', amount: -1_000_000n },
        { account: CASH_ACCOUNTS.FX_CLEARING, currency: 'USDC', amount: 1_000_000n },
        { account: CASH_ACCOUNTS.FX_CLEARING, currency: 'HKD', amount: -781_00n },
        { account: CASH_ACCOUNTS.BROKER_BUFFER, currency: 'HKD', amount: 781_00n },
      ],
    });
    ledger.assertBalanced();
    expect(ledger.balance(CASH_ACCOUNTS.BROKER_BUFFER, 'HKD').amount).toBe(781_00n);
  });

  it('rebuilds balances from the journal', async () => {
    const ledger = newLedger();
    await ledger.post(postings.buyEscrowed('int_1', usdc(1_000_000_000n)));
    const before = ledger.balance(CASH_ACCOUNTS.CHAIN_ESCROW, 'USDC');
    await ledger.load();
    expect(ledger.balance(CASH_ACCOUNTS.CHAIN_ESCROW, 'USDC')).toEqual(before);
  });

  /**
   * Each template is asserted on its own. A template that does not balance is a
   * defect that would otherwise only surface as a reconciliation break days
   * later, attributed to a counterparty that did nothing wrong.
   */
  describe('posting templates all balance', () => {
    const cases: Array<[string, () => ReturnType<typeof postings.buyEscrowed>]> = [
      ['buyEscrowed', () => postings.buyEscrowed('i', usdc(1_000_000_000n))],
      ['buyDeployed', () => postings.buyDeployed('i', usdc(1_000_000_000n), usdc(5_000_000n))],
      [
        'buyFilled',
        () => postings.buyFilled('i', hkd(109_620_00n), hkd(274_00n), hkd(120_00n), shares(300n)),
      ],
      ['custodySettled', () => postings.custodySettled('i', shares(300n))],
      [
        'buyMinted',
        () => postings.buyMinted('i', usdc(995_000_000n), hkd(109_620_00n), shares(300n)),
      ],
      ['buyCancelled', () => postings.buyCancelled('i', usdc(1_000_000_000n))],
      [
        'sellFilled',
        () =>
          postings.sellFilled(
            'i',
            hkd(110_000_00n),
            hkd(275_00n),
            hkd(121_00n),
            hkd(550_00n),
            shares(300n),
          ),
      ],
      [
        'sellSettled',
        () => postings.sellSettled('i', usdc(1_399_360_000n), hkd(109_450_00n), shares(300n)),
      ],
      ['sellCancelled', () => postings.sellCancelled('i', shares(300n))],
      [
        'conversionSettled',
        () =>
          postings.conversionSettled(
            'i',
            usdc(1_000_000_000n),
            hkd(7_809_219n),
            usdc(1_000_000n),
            'BROKER_BUFFER',
          ),
      ],
      ['sentToMsb', () => postings.sentToMsb('i', hkd(110_000_00n), 'BROKER_PROCEEDS')],
      ['brokerFunded', () => postings.brokerFunded('i', hkd(7_809_219n))],
      ['vaultDeposit', () => postings.vaultDeposit('i', usdc(1_000_000_000n))],
      ['vaultDeployed', () => postings.vaultDeployed('m', usdc(950_000_000n), usdc(50_000_000n))],
      [
        'vaultAllocated',
        () => postings.vaultAllocated('m', shares(5_000n), hkd(500_000_00n), hkd(100_000_00n)),
      ],
      ['vaultSettled', () => postings.vaultSettled('m', usdc(1_200_000_000n), usdc(950_000_000n))],
      ['vaultClaimed', () => postings.vaultClaimed('i', usdc(120_000_000n))],
      ['vaultRefunded', () => postings.vaultRefunded('i', usdc(990_000_000n), usdc(10_000_000n))],
      ['vaultDeliveryElected', () => postings.vaultDeliveryElected('i', shares(500n))],
      ['vaultDelivered', () => postings.vaultDelivered('i', shares(500n))],
      ['recogniseFxResult (gain)', () => postings.recogniseFxResult('r', usdc(12_345n))],
      ['recogniseFxResult (loss)', () => postings.recogniseFxResult('r', usdc(-12_345n))],
      ['feeSwept', () => postings.feeSwept('r', usdc(5_000_000n))],
      [
        'parkToSuspense',
        () => postings.parkToSuspense('r', usdc(1_000n), CASH_ACCOUNTS.MSB_TRANSIT, 'break'),
      ],
    ];

    for (const [name, build] of cases) {
      it(name, async () => {
        const ledger = newLedger();
        await ledger.post(build());
        ledger.assertBalanced();
      });
    }
  });

  it('tracks the buy lifecycle to a clean close', async () => {
    const ledger = newLedger();
    const escrowed = parseMoney('USDC', '1000');
    const spread = parseMoney('USDC', '5');
    const consideration = parseMoney('HKD', '7500.00');

    await ledger.post(postings.buyEscrowed('i', escrowed));
    expect(ledger.balance(CASH_ACCOUNTS.CHAIN_ESCROW, 'USDC').amount).toBe(1_000_000_000n);

    await ledger.post(postings.buyDeployed('i', escrowed, spread));
    // Escrow emptied; spread recognised as income the moment it is earned.
    expect(ledger.balance(CASH_ACCOUNTS.CHAIN_ESCROW, 'USDC').amount).toBe(0n);
    expect(ledger.balance(CASH_ACCOUNTS.INCOME_SPREAD, 'USDC').amount).toBe(-5_000_000n);
    expect(ledger.balance(CASH_ACCOUNTS.CHAIN_FEES_RECEIVABLE, 'USDC').amount).toBe(5_000_000n);

    await ledger.post(
      postings.buyFilled('i', consideration, hkd(100_00n), hkd(9_00n), shares(20n)),
    );
    await ledger.post(postings.custodySettled('i', shares(20n)));
    await ledger.post(postings.buyMinted('i', parseMoney('USDC', '995'), consideration, shares(20n)));

    ledger.assertBalanced();

    // The customer obligation is fully discharged and the position is booked.
    expect(ledger.balance(CASH_ACCOUNTS.CUSTOMER_ESCROW, 'USDC').amount).toBe(0n);
    expect(ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTOMER_POSITIONS, '0700.HK')).toBe(-20n);
    expect(ledger.signedPositionBalance(POSITION_ACCOUNTS.CUSTODY_HOLDINGS, '0700.HK')).toBe(20n);
    expect(ledger.signedPositionBalance(POSITION_ACCOUNTS.PENDING_ISSUANCE, '0700.HK')).toBe(0n);
  });
});
