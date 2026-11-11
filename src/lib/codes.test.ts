import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, defaultRng, generate, generateCode, isValidCode, normalize, normalizeCode } from './codes';

describe('codes', () => {
  it('generates 6 characters of 0-9A-Z', () => {
    for (let i = 0; i < 200; i++) {
      const c = generateCode();
      expect(c).toMatch(/^[0-9A-Z]{6}$/);
      expect(isValidCode(c)).toBe(true);
    }
  });

  it('is deterministic with an injected rng and covers the alphabet ends', () => {
    expect(generateCode(() => 0)).toBe('000000');
    expect(generateCode(() => 0.999999)).toBe('ZZZZZZ');
    expect(generateCode(() => 1)).toBe('ZZZZZZ'); // out-of-range rng is clamped
    const seq = [0, 10 / 36, 20 / 36, 35 / 36, 0.5, 1 / 36];
    let i = 0;
    expect(generateCode(() => seq[i++])).toBe('0AKZI1');
    expect(generateCode(() => 0, 8)).toHaveLength(8);
    expect(CODE_ALPHABET).toHaveLength(36);
    expect(generate).toBe(generateCode);
  });

  it('the default rng stays in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const r = defaultRng();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });

  it('normalizes typed codes (Ztyle chapter 11)', () => {
    expect(normalizeCode('k7qw2m')).toBe('K7QW2M');
    expect(normalizeCode(' k7-qw 2m! ')).toBe('K7QW2M');
    expect(normalizeCode('izzardry-chess')).toBe('IZZARDRY');
    expect(normalizeCode('äöü')).toBe('');
    expect(normalize('ab')).toBe('AB');
    expect(isValidCode('')).toBe(false);
    expect(isValidCode('A')).toBe(true);
    expect(isValidCode('ABCDEFGH')).toBe(true);
    expect(isValidCode('ABCDEFGHI')).toBe(false);
    expect(isValidCode('abc')).toBe(false);
  });
});
