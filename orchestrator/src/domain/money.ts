/**
 * Integer-only money.
 *
 * Every amount in this service is a bigint of minor units paired with a
 * currency. There are no floating point amounts anywhere in the money path —
 * a float that loses a satoshi of USDC on a million subscriptions is a real
 * loss, and it is invisible until reconciliation fails.
 *
 * Scale is a property of the currency, not of the value. That removes the
 * "same currency, different scale" class of bug entirely.
 */

export const CURRENCY_SCALE = {
  USDC: 6,
  USDT: 6,
  USD: 2,
  HKD: 2,
  CNH: 2,
} as const;

export type Currency = keyof typeof CURRENCY_SCALE;

export const CURRENCIES = Object.keys(CURRENCY_SCALE) as Currency[];

export function isCurrency(value: string): value is Currency {
  return Object.prototype.hasOwnProperty.call(CURRENCY_SCALE, value);
}

export function scaleOf(currency: Currency): number {
  return CURRENCY_SCALE[currency];
}

export interface Money {
  readonly currency: Currency;
  /** Signed minor units. 1_000_000n USDC === 1.000000 USDC. */
  readonly amount: bigint;
}

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

export function money(currency: Currency, amount: bigint | number | string): Money {
  if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) {
      throw new MoneyError(
        `money() requires integer minor units, received ${amount}. ` +
          `Use parseMoney() to convert a decimal string.`,
      );
    }
    return { currency, amount: BigInt(amount) };
  }
  return { currency, amount: typeof amount === 'string' ? BigInt(amount) : amount };
}

export function zero(currency: Currency): Money {
  return { currency, amount: 0n };
}

function assertSameCurrency(a: Money, b: Money, op: string): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Cannot ${op} ${a.currency} and ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'add');
  return { currency: a.currency, amount: a.amount + b.amount };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b, 'subtract');
  return { currency: a.currency, amount: a.amount - b.amount };
}

export function negate(a: Money): Money {
  return { currency: a.currency, amount: -a.amount };
}

export function absolute(a: Money): Money {
  return { currency: a.currency, amount: a.amount < 0n ? -a.amount : a.amount };
}

export function sum(currency: Currency, values: readonly Money[]): Money {
  let total = 0n;
  for (const value of values) {
    if (value.currency !== currency) {
      throw new MoneyError(`Cannot sum ${value.currency} into a ${currency} total`);
    }
    total += value.amount;
  }
  return { currency, amount: total };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b, 'compare');
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export const isZero = (a: Money): boolean => a.amount === 0n;
export const isPositive = (a: Money): boolean => a.amount > 0n;
export const isNegative = (a: Money): boolean => a.amount < 0n;
export const greaterThan = (a: Money, b: Money): boolean => compare(a, b) === 1;
export const greaterOrEqual = (a: Money, b: Money): boolean => compare(a, b) >= 0;
export const lessThan = (a: Money, b: Money): boolean => compare(a, b) === -1;
export const equals = (a: Money, b: Money): boolean =>
  a.currency === b.currency && a.amount === b.amount;

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

/* -------------------------------------------------------------------------- */
/* Rounding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rounding is always explicit at a call site. There is no default, because the
 * correct direction depends on who absorbs the remainder: fees round in the
 * customer's favour (DOWN), funding requirements round in ours (UP).
 */
export type Rounding = 'DOWN' | 'UP' | 'HALF_EVEN';

function divideRounded(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  if (denominator === 0n) throw new MoneyError('Division by zero');

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  if (remainder === 0n) return negative ? -quotient : quotient;

  let rounded: bigint;
  switch (rounding) {
    // DOWN and UP are magnitude-directed (toward and away from zero), so a
    // signed amount rounds symmetrically rather than drifting with its sign.
    case 'DOWN':
      rounded = quotient;
      break;
    case 'UP':
      rounded = quotient + 1n;
      break;
    case 'HALF_EVEN': {
      const twiceRemainder = remainder * 2n;
      if (twiceRemainder > absDenominator) rounded = quotient + 1n;
      else if (twiceRemainder < absDenominator) rounded = quotient;
      else rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
      break;
    }
  }
  return negative ? -rounded : rounded;
}

/** Multiply by a basis-point rate. 500 bps = 5.00%. */
export function basisPoints(value: Money, bps: number, rounding: Rounding): Money {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new MoneyError(`bps must be a non-negative integer, received ${bps}`);
  }
  return {
    currency: value.currency,
    amount: divideRounded(value.amount * BigInt(bps), 10_000n, rounding),
  };
}

export function multiply(value: Money, factor: bigint): Money {
  return { currency: value.currency, amount: value.amount * factor };
}

/**
 * Split an amount pro-rata across weights, distributing the remainder to the
 * largest weights first. The parts always sum exactly back to the input — a
 * pro-rata split that loses dust is how a vault ends up with stuck USDC.
 */
export function allocate(value: Money, weights: readonly bigint[]): Money[] {
  const totalWeight = weights.reduce((acc, w) => acc + w, 0n);
  if (totalWeight <= 0n) throw new MoneyError('allocate() requires a positive total weight');

  const parts = weights.map((weight) => (value.amount * weight) / totalWeight);
  let remainder = value.amount - parts.reduce((acc, p) => acc + p, 0n);

  // Hand out the remainder one minor unit at a time, largest weight first.
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => (b.weight > a.weight ? 1 : b.weight < a.weight ? -1 : a.index - b.index));

  const step = remainder >= 0n ? 1n : -1n;
  let cursor = 0;
  while (remainder !== 0n && order.length > 0) {
    const target = order[cursor % order.length]!;
    parts[target.index] = parts[target.index]! + step;
    remainder -= step;
    cursor += 1;
  }

  return parts.map((amount) => ({ currency: value.currency, amount }));
}

/* -------------------------------------------------------------------------- */
/* FX                                                                          */
/* -------------------------------------------------------------------------- */

/**
 * An exchange rate as an exact rational. Providers quote rates as decimal
 * strings; we keep them exact rather than routing them through a float.
 */
export interface FxRate {
  readonly from: Currency;
  readonly to: Currency;
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Build a rate from a decimal string, e.g. fxRate('USDC','HKD','7.8125'). */
export function fxRate(from: Currency, to: Currency, decimal: string): FxRate {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) throw new MoneyError(`Malformed rate: ${decimal}`);
  const [, sign, whole, fraction = ''] = match;
  if (sign === '-') throw new MoneyError(`Rate must be positive: ${decimal}`);

  const numerator = BigInt(`${whole}${fraction}`);
  const denominator = 10n ** BigInt(fraction.length);
  if (numerator === 0n) throw new MoneyError(`Rate must be positive: ${decimal}`);
  return { from, to, numerator, denominator };
}

export function invertRate(rate: FxRate): FxRate {
  return {
    from: rate.to,
    to: rate.from,
    numerator: rate.denominator,
    denominator: rate.numerator,
  };
}

/**
 * Convert across currencies, adjusting for the difference in minor-unit scale.
 * `rate` is expressed in major units (the way a provider quotes it).
 */
export function convert(value: Money, rate: FxRate, rounding: Rounding): Money {
  if (value.currency !== rate.from) {
    throw new MoneyError(`Rate converts ${rate.from}, received ${value.currency}`);
  }
  const scaleDelta = scaleOf(rate.to) - scaleOf(rate.from);
  const scaleNumerator = scaleDelta > 0 ? 10n ** BigInt(scaleDelta) : 1n;
  const scaleDenominator = scaleDelta < 0 ? 10n ** BigInt(-scaleDelta) : 1n;

  return {
    currency: rate.to,
    amount: divideRounded(
      value.amount * rate.numerator * scaleNumerator,
      rate.denominator * scaleDenominator,
      rounding,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatMoney(value: Money): string {
  const scale = scaleOf(value.currency);
  const negative = value.amount < 0n;
  const digits = (negative ? -value.amount : value.amount).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction} ${value.currency}`;
}

/** Parse a decimal major-unit string, e.g. parseMoney('HKD', '1234.56'). */
export function parseMoney(currency: Currency, decimal: string): Money {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) throw new MoneyError(`Malformed amount: ${decimal}`);
  const [, sign, whole, fraction = ''] = match;

  const scale = scaleOf(currency);
  if (fraction.length > scale) {
    throw new MoneyError(
      `${decimal} has ${fraction.length} decimal places but ${currency} has ${scale}. ` +
        `Refusing to silently truncate.`,
    );
  }
  const padded = fraction.padEnd(scale, '0');
  const amount = BigInt(`${whole}${padded}`);
  return { currency, amount: sign === '-' ? -amount : amount };
}

/** JSON-safe wire representation. bigint does not survive JSON.stringify. */
export interface MoneyWire {
  currency: Currency;
  amount: string;
  decimal: string;
}

export function toWire(value: Money): MoneyWire {
  return {
    currency: value.currency,
    amount: value.amount.toString(),
    decimal: formatMoney(value).replace(` ${value.currency}`, ''),
  };
}

export function fromWire(wire: MoneyWire): Money {
  if (!isCurrency(wire.currency)) throw new MoneyError(`Unknown currency: ${wire.currency}`);
  return { currency: wire.currency, amount: BigInt(wire.amount) };
}

/* -------------------------------------------------------------------------- */
/* Share quantities                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Share counts are whole units. HKEX trades in board lots, and the lot size is
 * a property of the listing, enforced at the broker port rather than here.
 */
export interface Quantity {
  readonly ticker: string;
  readonly units: bigint;
}

export function quantity(ticker: string, units: bigint | number): Quantity {
  const value = typeof units === 'number' ? BigInt(units) : units;
  if (value < 0n) throw new MoneyError(`Share quantity cannot be negative: ${value}`);
  return { ticker, units: value };
}

export function addQuantity(a: Quantity, b: Quantity): Quantity {
  if (a.ticker !== b.ticker) throw new MoneyError(`Cannot add ${a.ticker} and ${b.ticker}`);
  return { ticker: a.ticker, units: a.units + b.units };
}

export function subtractQuantity(a: Quantity, b: Quantity): Quantity {
  if (a.ticker !== b.ticker) throw new MoneyError(`Cannot subtract ${b.ticker} from ${a.ticker}`);
  return { ticker: a.ticker, units: a.units - b.units };
}

/**
 * Notional for a share quantity at a per-share price.
 * Rounds UP for buys (we must fund at least the fill) and DOWN for sells.
 */
export function notional(qty: Quantity, pricePerShare: Money, rounding: Rounding): Money {
  return {
    currency: pricePerShare.currency,
    amount: divideRounded(pricePerShare.amount * qty.units, 1n, rounding),
  };
}

/** Per-share price implied by a total consideration and a share count. */
export function impliedPrice(total: Money, qty: Quantity, rounding: Rounding): Money {
  if (qty.units === 0n) throw new MoneyError('Cannot imply a price from zero shares');
  return { currency: total.currency, amount: divideRounded(total.amount, qty.units, rounding) };
}
