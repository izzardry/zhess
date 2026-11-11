import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { QR_MAX_VERSION, qrMatrix, qrPath, qrSizeOf, qrSvg } from './qr';
import { offerLink } from './transport/manual';
import { encodeSdp } from './transport/sdp';
import { CHROME_OFFER } from './transport/sdpFixtures';

/** Byte-mode capacity of a version at level M, read from the library itself. */
function fits(len: number, version: number, ecl: 'L' | 'M' = 'M'): boolean {
  try {
    const q = qrcode(version as Parameters<typeof qrcode>[0], ecl);
    q.addData('a'.repeat(len), 'Byte');
    q.make();
    return true;
  } catch {
    return false;
  }
}

/** Longest byte payload that fits `version`. */
function capacity(version: number, ecl: 'L' | 'M' = 'M'): number {
  let lo = 0;
  let hi = 4000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid, version, ecl)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

describe('qrMatrix', () => {
  it('encodes a short link in a small version with finder patterns', () => {
    const m = qrMatrix('https://example.org/zhess/#/?s=K7QW2M&o=r');
    expect(m).not.toBeNull();
    expect(m!.size).toBe(qrSizeOf(m!.version));
    expect(m!.version).toBeLessThanOrEqual(4);
    // Top-left finder: dark 7×7 border, light ring, dark 3×3 centre.
    const at = (r: number, c: number) => m!.modules[r][c];
    expect([0, 1, 2, 3, 4, 5, 6].every((i) => at(0, i) && at(6, i) && at(i, 0) && at(i, 6))).toBe(true);
    expect(at(1, 1)).toBe(false);
    expect(at(3, 3)).toBe(true);
    expect(m!.modules.every((row) => row.length === m!.size)).toBe(true);
  });

  it('picks the smallest version that fits', () => {
    const cap10 = capacity(10);
    expect(qrMatrix('a'.repeat(cap10))!.version).toBe(10);
    expect(qrMatrix('a'.repeat(cap10 + 1))!.version).toBe(11);
  });

  it('returns null above version 25 (the link is shown alone)', () => {
    const cap = capacity(QR_MAX_VERSION);
    expect(cap).toBeGreaterThan(900);
    expect(qrMatrix('a'.repeat(cap))!.version).toBe(QR_MAX_VERSION);
    expect(qrMatrix('a'.repeat(cap + 1))).toBeNull();
    expect(qrSvg('a'.repeat(cap + 1))).toBeNull();
  });

  it('returns null beyond version 40 instead of throwing', () => {
    expect(qrMatrix('a'.repeat(5000), { maxVersion: 40 })).toBeNull();
  });

  it('honours a custom limit and error correction level', () => {
    const capL = capacity(5, 'L');
    expect(qrMatrix('a'.repeat(capL), { ecl: 'L', maxVersion: 5 })!.version).toBe(5);
    expect(qrMatrix('a'.repeat(capL + 1), { ecl: 'L', maxVersion: 5 })).toBeNull();
    expect(qrMatrix('a'.repeat(capL), { maxVersion: 5 })).toBeNull(); // M holds less
  });

  it('encodes non-ASCII text as UTF-8', () => {
    const m = qrMatrix('Zhess ♞ é');
    expect(m).not.toBeNull();
  });

  it('a real manual offer link gets a QR code well below the limit', async () => {
    const link = offerLink('K7QW2M', await encodeSdp(CHROME_OFFER, 'offer'), 'https://izzardry.github.io/zhess/');
    const m = qrMatrix(link);
    expect(m).not.toBeNull();
    expect(m!.version).toBeLessThanOrEqual(15);
  });
});

describe('qrPath / qrSvg', () => {
  it('draws one rectangle per horizontal run, offset by the margin', () => {
    const m = { version: 1, size: 3, modules: [[true, true, false], [false, false, false], [true, false, true]] };
    expect(qrPath(m)).toBe('M0 0h2v1h-2zM0 2h1v1h-1zM2 2h1v1h-1z');
    expect(qrPath(m, 4)).toBe('M4 4h2v1h-2zM4 6h1v1h-1zM6 6h1v1h-1z');
  });

  it('covers exactly the dark modules', () => {
    const m = qrMatrix('zhess')!;
    const dark = m.modules.flat().filter(Boolean).length;
    const covered = [...qrPath(m).matchAll(/h(\d+)v1/g)].reduce((s, x) => s + Number(x[1]), 0);
    expect(covered).toBe(dark);
  });

  it('reports the viewBox with the quiet zone', () => {
    const s = qrSvg('zhess')!;
    expect(s.viewBox).toBe(qrSizeOf(s.version) + 8);
    expect(qrSvg('zhess', { margin: 0 })!.viewBox).toBe(qrSizeOf(s.version));
    expect(s.path.startsWith('M4 4h7')).toBe(true);
  });
});
