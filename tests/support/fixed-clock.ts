import type { Clock } from '../../src/application/ports.ts';

/** Test double (stub) for the Clock port: time only moves when a test moves it. */
export class FixedClock implements Clock {
  private current: number;

  constructor(iso: string) {
    this.current = Date.parse(iso);
    if (Number.isNaN(this.current)) throw new Error(`bad ISO time: ${iso}`);
  }

  now(): number {
    return this.current;
  }

  set(iso: string): void {
    this.current = Date.parse(iso);
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
