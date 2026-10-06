import { describe, expect, it } from 'vitest';
import {
  allocate,
  basisPoints,
  convert,
  formatMoney,
  fxRate,
  impliedPrice,
  money,
  notional,
  parseMoney,
  subtract,
  sum,
} from '../src/domain/money.js';

describe('money', () => {
  it('refuses a non-integer minor unit', () => {
    expect(() => money('USDC', 1.5 as unknown as number)).toThrow(/integer minor units/);
  });

  it('refuses to silently truncate excess precision', () => {
    // 7 decimals into a 6-decimal currency would lose value. Rejecting is the
    // only safe behaviour: rounding here would be an invisible haircut.
    expect(() => parseMoney('USDC', '1.1234567')).toThrow(/Refusing to silently truncate/);
    expect(parseMoney('USDC', '1.123456').amount).toBe(1_123_456n);
  });

  it('formats and parses round-trip', () => {
    const value = parseMoney('HKD', '1234.56');
    expect(value.amount).toBe(123_456n);
    expect(formatMoney(value)).toBe('1234.56 HKD');
  });

  it('will not mix currencies', () => {
    expect(() => subtract(money('USDC', 1n), money('HKD', 1n))).toThrow(/Cannot subtract/);
  });

  describe('basis points', () => {
    it('computes a 5% vault fee exactly', () => {
      // 1,000 USDC in → 50 fee → 950 subscribed, per the fee schedule.
      const deposit = parseMoney('USDC', '1000');
      const fee = basisPoints(deposit, 500, 'DOWN');
      expect(formatMoney(fee)).toBe('50.000000 USDC');
      expect(formatMoney(subtract(deposit, fee))).toBe('950.000000 USDC');
    });

    it('rounds in the stated direction', () => {
      const value = money('USDC', 333n);
      expect(basisPoints(value, 50, 'DOWN').amount).toBe(1n);
      expect(basisPoints(value, 50, 'UP').amount).toBe(2n);
    });

    it('matches the worked example in the fee documentation', () => {
      // 3,000,000 subscribed → 150,000 fee → 2,850,000 deployed.
      const subscribed = parseMoney('USDC', '3000000');
      const fee = basisPoints(subscribed, 500, 'DOWN');
      expect(formatMoney(fee)).toBe('150000.000000 USDC');
      expect(formatMoney(subtract(subscribed, fee))).toBe('2850000.000000 USDC');
    });
  });

  describe('allocate', () => {
    it('never loses a minor unit', () => {
      const pool = money('USDC', 1_000_000n);
      const parts = allocate(pool, [1n, 1n, 1n]);
      expect(sum('USDC', parts).amount).toBe(pool.amount);
      expect(parts.map((p) => p.amount)).toEqual([333_334n, 333_333n, 333_333n]);
    });

    it('gives the remainder to the largest weights', () => {
      const parts = allocate(money('USDC', 10n), [7n, 2n, 1n]);
      expect(sum('USDC', parts).amount).toBe(10n);
      expect(parts[0]!.amount).toBeGreaterThanOrEqual(parts[2]!.amount);
    });

    it('handles a pro-rata redemption across many holders without drift', () => {
      const redeemable = money('USDC', 2_850_000_000_000n);
      const weights = Array.from({ length: 97 }, (_, i) => BigInt(i + 1));
      const parts = allocate(redeemable, weights);
      expect(sum('USDC', parts).amount).toBe(redeemable.amount);
    });
  });

  describe('fx', () => {
    it('adjusts for the difference in minor-unit scale', () => {
      // 1,000.000000 USDC at 7.81 → 7,810.00 HKD (6dp source, 2dp target).
      const converted = convert(parseMoney('USDC', '1000'), fxRate('USDC', 'HKD', '7.8100'), 'DOWN');
      expect(formatMoney(converted)).toBe('7810.00 HKD');
    });

    it('round-trips within one minor unit', () => {
      const start = parseMoney('HKD', '7810.00');
      const toUsdc = convert(start, fxRate('HKD', 'USDC', '0.128'), 'DOWN');
      const back = convert(toUsdc, fxRate('USDC', 'HKD', '7.8125'), 'DOWN');
      expect(Number(back.amount - start.amount)).toBeLessThanOrEqual(1);
    });

    it('rejects a malformed rate', () => {
      expect(() => fxRate('USDC', 'HKD', '7.81.2')).toThrow(/Malformed rate/);
      expect(() => fxRate('USDC', 'HKD', '0')).toThrow(/must be positive/);
    });
  });

  describe('share economics', () => {
    it('rounds a buy notional up so funding is never short', () => {
      const qty = { ticker: '0700.HK', units: 300n };
      const price = parseMoney('HKD', '365.40');
      expect(formatMoney(notional(qty, price, 'UP'))).toBe('109620.00 HKD');
    });

    it('derives an implied price from consideration', () => {
      const total = parseMoney('HKD', '109620.00');
      const price = impliedPrice(total, { ticker: '0700.HK', units: 300n }, 'DOWN');
      expect(formatMoney(price)).toBe('365.40 HKD');
    });

    it('refuses to imply a price from zero shares', () => {
      expect(() => impliedPrice(money('HKD', 1n), { ticker: 'X', units: 0n }, 'DOWN')).toThrow(
        /zero shares/,
      );
    });
  });
});
