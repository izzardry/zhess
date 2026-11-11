/**
 * Pure helpers for move numbering and figurine notation. No React.
 */
import type { Color, PieceType } from '@/lib/types';

/** A SAN string split into text and piece parts: `Nxf3+` → [{piece:'n'}, 'xf3+']. */
export type FigurinePart = string | { piece: PieceType };

const SAN_PIECES: Record<string, PieceType> = { K: 'k', Q: 'q', R: 'r', B: 'b', N: 'n' };

/** Splits SAN so piece letters can be drawn as figurines: the leading piece and a promotion piece. */
export function figurineParts(san: string): FigurinePart[] {
  const parts: FigurinePart[] = [];
  let rest = san;
  const lead = SAN_PIECES[rest[0]];
  if (lead && !rest.startsWith('O')) {
    parts.push({ piece: lead });
    rest = rest.slice(1);
  }
  const promo = /=([QRBN])/.exec(rest);
  if (promo) {
    const before = rest.slice(0, promo.index + 1); // keep "="
    const after = rest.slice(promo.index + 2);
    if (before) parts.push(before);
    parts.push({ piece: SAN_PIECES[promo[1]] });
    if (after) parts.push(after);
  } else if (rest) {
    parts.push(rest);
  }
  return parts;
}

/** Move number and color of ply `i` (0-based), given the first move's number and color. */
export function plyNumber(i: number, firstMoveNumber = 1, firstColor: Color = 'w'): { number: number; color: Color } {
  const offset = firstColor === 'b' ? 1 : 0;
  const k = i + offset;
  return { number: firstMoveNumber + Math.floor(k / 2), color: k % 2 === 0 ? 'w' : 'b' };
}

/** One entry of the move strip: the move number, and white's and black's SAN of that move (either may be absent). */
export interface MovePair {
  number: number;
  /** Ply index of white's move, or undefined. */
  w?: { san: string; ply: number };
  /** Ply index of black's move, or undefined. */
  b?: { san: string; ply: number };
}

/** Groups SAN plies into numbered move pairs. */
export function movePairs(sans: readonly string[], firstMoveNumber = 1, firstColor: Color = 'w'): MovePair[] {
  const pairs: MovePair[] = [];
  sans.forEach((san, ply) => {
    const { number, color } = plyNumber(ply, firstMoveNumber, firstColor);
    let pair = pairs[pairs.length - 1];
    if (!pair || pair.number !== number) {
      pair = { number };
      pairs.push(pair);
    }
    pair[color] = { san, ply };
  });
  return pairs;
}

/**
 * The move strip of the info pill (DESIGN 4.2): the pair holding the last applied ply (`cursor - 1`),
 * cut after that ply. Null at the start position.
 */
export function stripPair(
  sans: readonly string[],
  cursor: number,
  firstMoveNumber = 1,
  firstColor: Color = 'w',
): MovePair | null {
  const last = Math.min(cursor, sans.length) - 1;
  if (last < 0) return null;
  const { number, color } = plyNumber(last, firstMoveNumber, firstColor);
  const pair: MovePair = { number };
  pair[color] = { san: sans[last], ply: last };
  if (color === 'b' && last > 0) pair.w = { san: sans[last - 1], ply: last - 1 };
  return pair;
}

/** Number of full moves in a game of `plies` half-moves (34 moves = 67 or 68 plies). */
export function fullMoves(plies: number): number {
  return Math.ceil(Math.max(0, plies) / 2);
}

/** Room score in points: `1.5` → `1½`, `0.5` → `½`. */
export function formatPoints(points: number): string {
  const whole = Math.floor(points);
  const half = points - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

const CAPTURE_ORDER: readonly PieceType[] = ['p', 'n', 'b', 'r', 'q', 'k'];

/** Captured pieces grouped by type, in the order p, n, b, r, q (player strips). */
export function groupCaptured(captured: readonly PieceType[]): { type: PieceType; count: number }[] {
  return CAPTURE_ORDER.map((type) => ({ type, count: captured.filter((p) => p === type).length })).filter((g) => g.count > 0);
}
