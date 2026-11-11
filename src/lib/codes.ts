/**
 * Game codes (Ztyle chapter 11, DESIGN 4.1).
 *
 * Alphabet `0-9A-Z`, uppercase. Generated codes have 6 characters; typed codes are accepted
 * with 1–8 characters after normalization. In Zhess the code names a game (and, for rooms,
 * the room); nothing is generated from it.
 */
import type { Rng } from './types';

export const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const CODE_MAX_LENGTH = 8;

/** Uniform [0, 1) from WebCrypto when available, else Math.random. */
export function defaultRng(): number {
  try {
    const c = globalThis.crypto;
    if (c?.getRandomValues) {
      const a = new Uint32Array(1);
      c.getRandomValues(a);
      return a[0] / 2 ** 32;
    }
  } catch {
    /* fall through */
  }
  return Math.random();
}

/** A new random code of `CODE_LENGTH` characters. Pass `rng` for deterministic tests. */
export function generateCode(rng: Rng = defaultRng, length: number = CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const r = rng();
    const idx = Math.min(CODE_ALPHABET.length - 1, Math.max(0, Math.floor(r * CODE_ALPHABET.length)));
    out += CODE_ALPHABET[idx];
  }
  return out;
}

/** `toUpperCase()`, strip everything outside `0-9A-Z`, cut to 8. May return an empty string. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_MAX_LENGTH);
}

/** True for a code of 1–8 characters of `0-9A-Z`. */
export function isValidCode(code: string): boolean {
  return /^[0-9A-Z]{1,8}$/.test(code);
}

/** Short aliases. */
export const generate = generateCode;
export const normalize = normalizeCode;
