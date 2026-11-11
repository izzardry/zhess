import { describe, expect, it } from 'vitest';
import { LOW_TIME_MS, formatClock, formatElapsed, isLowTime } from './timeUtils';

describe('formatClock (DESIGN 11)', () => {
  it('shows m:ss from 10 seconds up, rounding down', () => {
    expect(formatClock(300_000)).toBe('5:00');
    expect(formatClock(299_999)).toBe('4:59');
    expect(formatClock(61_000)).toBe('1:01');
    expect(formatClock(10_000)).toBe('0:10');
    expect(formatClock(5_400_000)).toBe('90:00');
  });

  it('shows s.t with tenths below 10 seconds', () => {
    expect(formatClock(9_999)).toBe('9.9');
    expect(formatClock(9_000)).toBe('9.0');
    expect(formatClock(1_250)).toBe('1.2');
    expect(formatClock(99)).toBe('0.0');
    expect(formatClock(100)).toBe('0.1');
  });

  it('shows 0.0 at and below zero and for junk', () => {
    expect(formatClock(0)).toBe('0.0');
    expect(formatClock(-500)).toBe('0.0');
    expect(formatClock(Number.NaN)).toBe('0.0');
  });

  it('flags low time', () => {
    expect(LOW_TIME_MS).toBe(10_000);
    expect(isLowTime(9_999)).toBe(true);
    expect(isLowTime(10_000)).toBe(false);
    expect(isLowTime(0)).toBe(true);
  });
});

describe('formatElapsed', () => {
  it('shows m:ss and h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9_999)).toBe('0:09');
    expect(formatElapsed(728_000)).toBe('12:08');
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
    expect(formatElapsed(-1)).toBe('0:00');
  });
});
