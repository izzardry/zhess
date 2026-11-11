/**
 * QR codes for the invite and the manual signalling links (DESIGN 9.9), drawn by the app with
 * `qrcode-generator` (MIT). Scanning uses the phone's camera app; Zhess has no scanner.
 *
 * Rule (PLAN 7): if a payload needs more than QR version 25 (117 × 117 modules), there is no QR
 * and the UI shows the link only. Every function here returns null in that case.
 *
 * Error correction is `M` by default (about 15 % of the code may be damaged), a common choice for
 * codes shown on a screen; `L` packs more into a version if a caller needs it.
 */
import qrcode from 'qrcode-generator';

export type QrEcl = 'L' | 'M' | 'Q' | 'H';

/** Largest QR version Zhess shows (PLAN 7). */
export const QR_MAX_VERSION = 25;

export interface QrOptions {
  /** Error correction level. Default `M`. */
  ecl?: QrEcl;
  /** Largest acceptable version, 1–40. Default `QR_MAX_VERSION`. */
  maxVersion?: number;
}

export interface QrMatrix {
  /** QR version 1–40 (the smallest that fits). */
  readonly version: number;
  /** Modules per side: `17 + 4 × version`. */
  readonly size: number;
  /** `modules[row][col]`, true = dark. */
  readonly modules: readonly (readonly boolean[])[];
}

/** Modules per side of a version. */
export function qrSizeOf(version: number): number {
  return 17 + 4 * version;
}

/**
 * The QR matrix of `text` (byte mode), or null if it needs more than `maxVersion` or cannot be
 * encoded at all. Non-ASCII text is UTF-8 encoded first.
 */
export function qrMatrix(text: string, opts: QrOptions = {}): QrMatrix | null {
  const maxVersion = Math.max(1, Math.min(40, opts.maxVersion ?? QR_MAX_VERSION));
  let data = text;
  // qrcode-generator's default byte mode takes one char per byte: encode non-ASCII as UTF-8 bytes.
  if ([...text].some((ch) => ch.charCodeAt(0) > 0x7f)) {
    data = String.fromCharCode(...new TextEncoder().encode(text));
  }
  try {
    const qr = qrcode(0, opts.ecl ?? 'M');
    qr.addData(data, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    const version = (size - 17) / 4;
    if (version > maxVersion) return null;
    const modules: boolean[][] = [];
    for (let r = 0; r < size; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
      modules.push(row);
    }
    return { version, size, modules };
  } catch {
    // "code length overflow": more than version 40 holds.
    return null;
  }
}

/**
 * An SVG path (`d`) drawing the dark modules, one unit per module, offset by `margin` modules
 * (the quiet zone). Horizontal runs are merged into one rectangle each.
 */
export function qrPath(m: QrMatrix, margin = 0): string {
  const parts: string[] = [];
  for (let r = 0; r < m.size; r++) {
    const row = m.modules[r];
    let c = 0;
    while (c < m.size) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < m.size && row[c]) c++;
      parts.push(`M${start + margin} ${r + margin}h${c - start}v1h-${c - start}z`);
    }
  }
  return parts.join('');
}

export interface QrSvg {
  version: number;
  /** Side of the square `viewBox` in modules, quiet zone included. */
  viewBox: number;
  /** Path of the dark modules inside `0 0 viewBox viewBox`. */
  path: string;
}

/**
 * Everything a component needs to draw the QR of `text` as
 * `<svg viewBox="0 0 {viewBox} {viewBox}"><path d={path} fill="currentColor"/></svg>`
 * (with a light background behind it), or null when the link must be shown alone.
 * `margin` is the quiet zone in modules, default 4 (the QR standard).
 */
export function qrSvg(text: string, opts: QrOptions & { margin?: number } = {}): QrSvg | null {
  const m = qrMatrix(text, opts);
  if (!m) return null;
  const margin = Math.max(0, opts.margin ?? 4);
  return { version: m.version, viewBox: m.size + 2 * margin, path: qrPath(m, margin) };
}
