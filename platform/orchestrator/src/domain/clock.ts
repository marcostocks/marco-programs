/**
 * Time is injected, never read from the ambient environment.
 *
 * Every deadline in this service is money-relevant — funding windows, election
 * windows, settlement cut-offs, webhook replay tolerance — and a test that
 * cannot control the clock cannot test any of them.
 */

export interface Clock {
  now(): Date;
  nowIso(): string;
  nowMillis(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
  nowMillis: () => Date.now(),
};

/** A clock that only moves when a test moves it. */
export class TestClock implements Clock {
  private current: number;

  constructor(start: Date | string | number = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  nowIso(): string {
    return new Date(this.current).toISOString();
  }

  nowMillis(): number {
    return this.current;
  }

  advance(millis: number): void {
    this.current += millis;
  }

  advanceSeconds(seconds: number): void {
    this.advance(seconds * 1000);
  }

  set(at: Date | string | number): void {
    this.current = new Date(at).getTime();
  }
}
