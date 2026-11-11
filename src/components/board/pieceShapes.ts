/**
 * The Zhess piece set (DESIGN 5.1): six shapes with thin, even strokes on a 100 × 100 box.
 *
 * Pure data so it can be reused anywhere an SVG is drawn: the board, captured pieces, the move
 * strip, thumbnails, the promotion dial, and the app-icon script. Each shape is a list of parts:
 *
 * - `body`   filled with the piece fill, stroked with the outline (white: background fill +
 *            foreground stroke; black: foreground fill + foreground stroke),
 * - `detail` stroke-only inner lines in the contrast color (white: foreground; black: background),
 * - `dot`    small filled marks in the contrast color (the knight's eye),
 * - `line`   stroke-only lines in the outline color (the king's cross).
 */
import type { Color, PieceType } from '@/lib/types';

export type PiecePart =
  | { readonly kind: 'body' | 'detail' | 'line'; readonly d: string }
  | { readonly kind: 'body' | 'dot'; readonly circle: readonly [cx: number, cy: number, r: number] };

/** Shared plinth. */
const BASE = 'M24 88 H76 V83 Q76 78 71 78 H29 Q24 78 24 83 Z';

export const PIECE_SHAPES: Readonly<Record<PieceType, readonly PiecePart[]>> = {
  p: [
    { kind: 'body', d: 'M35 78 C35 65 42 58 44 47 H56 C58 58 65 65 65 78 Z' },
    { kind: 'body', d: 'M39 42 H61 Q63 42 63 44.5 Q63 47 61 47 H39 Q37 47 37 44.5 Q37 42 39 42 Z' },
    { kind: 'body', circle: [50, 29, 12] },
    { kind: 'body', d: BASE },
  ],
  r: [
    { kind: 'body', d: 'M33 78 L36 46 H64 L67 78 Z' },
    { kind: 'body', d: 'M30 46 V20 H39 V28 H46 V20 H54 V28 H61 V20 H70 V46 Z' },
    { kind: 'detail', d: 'M36 46 H64' },
    { kind: 'body', d: BASE },
  ],
  b: [
    { kind: 'body', d: 'M37 78 C40 68 44 61 44 54 H56 C56 61 60 68 63 78 Z' },
    { kind: 'body', d: 'M40 49 H60 Q62 49 62 51.5 Q62 54 60 54 H40 Q38 54 38 51.5 Q38 49 40 49 Z' },
    { kind: 'body', circle: [50, 10, 4.5] },
    { kind: 'body', d: 'M50 16 C63 27 66 39 59 49 H41 C34 39 37 27 50 16 Z' },
    { kind: 'detail', d: 'M45 36 L56 25' },
    { kind: 'body', d: BASE },
  ],
  n: [
    {
      kind: 'body',
      d: 'M33 78 C33 64 40 58 48 50 C42 50 37 54 31 56 C24 58 20 52 24 47 L40 30 C42 24 46 19 50 14 L53 22 C66 25 75 40 72 78 Z',
    },
    { kind: 'dot', circle: [43, 33, 3] },
    { kind: 'detail', d: 'M58 30 C65 40 67 55 66 70' },
    { kind: 'body', d: BASE },
  ],
  q: [
    { kind: 'body', circle: [20, 31, 4.5] },
    { kind: 'body', circle: [35, 25, 4.5] },
    { kind: 'body', circle: [50, 21, 4.5] },
    { kind: 'body', circle: [65, 25, 4.5] },
    { kind: 'body', circle: [80, 31, 4.5] },
    { kind: 'body', d: 'M29 78 L20 36 L31 56 L35 30 L43 52 L50 26 L57 52 L65 30 L69 56 L80 36 L71 78 Z' },
    { kind: 'detail', d: 'M31 69 H69' },
    { kind: 'body', d: BASE },
  ],
  k: [
    { kind: 'line', d: 'M50 9 V27 M42 16 H58' },
    {
      kind: 'body',
      d: 'M30 78 C28 68 19 61 21 52 C23 42 38 39 50 52 C62 39 77 42 79 52 C81 61 72 68 70 78 Z',
    },
    { kind: 'body', d: 'M50 52 C42 44 43 35 50 28 C57 35 58 44 50 52 Z' },
    { kind: 'detail', d: 'M31 69 H69' },
    { kind: 'body', d: BASE },
  ],
};

/** Default stroke width in viewBox units (100 = one piece). */
export const PIECE_STROKE = 3.5;

/**
 * A stroke width that stays visible when a piece is drawn small: about 0.9 px on screen, never
 * thinner than the default, never heavier than 10 units.
 */
export function strokeForSize(px: number | undefined): number {
  if (!px || px <= 0) return PIECE_STROKE;
  return Math.min(10, Math.max(PIECE_STROKE, 90 / px));
}

/** Paint of a piece. Colors are CSS colors; the defaults follow the theme tokens. */
export interface PiecePaint {
  readonly fill: string;
  readonly stroke: string;
  readonly contrast: string;
}

export const FOREGROUND = 'hsl(var(--foreground))';
export const BACKGROUND = 'hsl(var(--background))';

/** White: background fill + foreground outline. Black: foreground fill + background details. */
export function piecePaint(color: Color, fg = FOREGROUND, bg = BACKGROUND): PiecePaint {
  return color === 'w' ? { fill: bg, stroke: fg, contrast: fg } : { fill: fg, stroke: fg, contrast: bg };
}

/**
 * Standalone SVG markup of a piece, for scripts (app icon, OG image) and tests.
 * Pass literal colors (e.g. `#0d0d0d`, `#fafafa`) where CSS variables are not available.
 */
export function pieceSvgMarkup(
  type: PieceType,
  color: Color,
  opts: { size?: number; fg?: string; bg?: string; strokeWidth?: number } = {},
): string {
  const paint = piecePaint(color, opts.fg ?? FOREGROUND, opts.bg ?? BACKGROUND);
  const sw = opts.strokeWidth ?? strokeForSize(opts.size);
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  const parts = PIECE_SHAPES[type]
    .map((p) => {
      const style = partStyle(p.kind, paint);
      const attrs = `fill="${style.fill}" stroke="${style.stroke}"`;
      return 'circle' in p
        ? `<circle cx="${p.circle[0]}" cy="${p.circle[1]}" r="${p.circle[2]}" ${attrs}/>`
        : `<path d="${p.d}" ${attrs}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${size} stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">${parts}</svg>`;
}

/** Fill and stroke of one part. */
export function partStyle(kind: PiecePart['kind'], paint: PiecePaint): { fill: string; stroke: string } {
  switch (kind) {
    case 'body':
      return { fill: paint.fill, stroke: paint.stroke };
    case 'detail':
      return { fill: 'none', stroke: paint.contrast };
    case 'dot':
      return { fill: paint.contrast, stroke: 'none' };
    case 'line':
      return { fill: 'none', stroke: paint.stroke };
  }
}
