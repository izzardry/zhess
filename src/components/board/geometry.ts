/**
 * Pure board geometry: square ↔ screen cell, hit testing, FEN parsing for thumbnails, premove
 * targets. No React, no DOM beyond the `DOMRect`-like shape.
 */
import type { Color, Piece, PieceType, Square, Uci } from '@/lib/types';

export const FILES = 'abcdefgh';
export const BOARD_SIZE = 8;

/** Default `--cell-size` (DESIGN 5.1). */
export const DEFAULT_CELL_SIZE = 'clamp(34px, min(11.5vw, 10vh), 76px)';

/** Column (0 left … 7 right) and row (0 top … 7 bottom) of a square as drawn. */
export function squareToCell(sq: Square, orientation: Color): { col: number; row: number } {
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]) - 1;
  return orientation === 'w' ? { col: file, row: 7 - rank } : { col: 7 - file, row: rank };
}

/** Square drawn at a column and row, or null outside the board. */
export function cellToSquare(col: number, row: number, orientation: Color): Square | null {
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  const file = orientation === 'w' ? col : 7 - col;
  const rank = orientation === 'w' ? 7 - row : row;
  return `${FILES[file]}${rank + 1}` as Square;
}

/** Squares in drawing order: rows top to bottom, each left to right. */
export function drawOrder(orientation: Color): Square[][] {
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => cellToSquare(col, row, orientation) as Square),
  );
}

/** a1 is dark. */
export function isLightSquare(sq: Square): boolean {
  const file = FILES.indexOf(sq[0]);
  const rank = Number(sq[1]) - 1;
  return (file + rank) % 2 === 1;
}

/** The box a hit test runs against (a `DOMRect` fits). */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Square under a client point inside the board box, or null. */
export function squareAt(x: number, y: number, box: Box | null, orientation: Color): Square | null {
  if (!box || box.width <= 0 || box.height <= 0) return null;
  const col = Math.floor(((x - box.left) / box.width) * 8);
  const row = Math.floor(((y - box.top) / box.height) * 8);
  return cellToSquare(col, row, orientation);
}

/** Client center of a square inside the board box. */
export function squareCenter(sq: Square, box: Box, orientation: Color): { x: number; y: number } {
  const { col, row } = squareToCell(sq, orientation);
  return {
    x: box.left + ((col + 0.5) * box.width) / 8,
    y: box.top + ((row + 0.5) * box.height) / 8,
  };
}

/** Moves a square by a screen direction (arrow keys), clamped to the board. */
export function stepSquare(sq: Square, dCol: number, dRow: number, orientation: Color): Square {
  const { col, row } = squareToCell(sq, orientation);
  const c = Math.max(0, Math.min(7, col + dCol));
  const r = Math.max(0, Math.min(7, row + dRow));
  return cellToSquare(c, r, orientation) as Square;
}

/** True when a pawn of `color` reaches its last rank on `to`. */
export function isPromotionRank(color: Color, to: Square): boolean {
  return to[1] === (color === 'w' ? '8' : '1');
}

/**
 * Pieces of a FEN's placement field, indexed like `zhess.board` (a1 = 0 … h8 = 63).
 * Lenient: a malformed FEN yields whatever could be read (missing squares stay empty).
 */
export function parseFenBoard(fen: string): (Piece | null)[] {
  const out: (Piece | null)[] = Array.from({ length: 64 }, () => null);
  const placement = (fen.trim().split(/\s+/)[0] ?? '').split('/');
  for (let r = 0; r < 8 && r < placement.length; r++) {
    const rank = 7 - r;
    let file = 0;
    for (const ch of placement[r]) {
      if (file > 7) break;
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        out[file + 8 * rank] = {
          color: ch === ch.toUpperCase() ? 'w' : 'b',
          type: ch.toLowerCase() as PieceType,
        };
        file += 1;
      } else {
        break;
      }
    }
  }
  return out;
}

const index = (sq: Square) => FILES.indexOf(sq[0]) + 8 * (Number(sq[1]) - 1);
const at = (file: number, rank: number): Square | null =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8 ? (`${FILES[file]}${rank + 1}` as Square) : null;

/**
 * Squares a piece may be premoved to (DESIGN 6.3), Lichess style: sliding pieces ignore blockers
 * (the position will change before the premove plays), pawns may go forward or capture
 * diagonally, the king may castle from its start square while the FEN still grants the right.
 * Whether the premove is legal is decided only when it is played.
 */
export function premoveTargets(fen: string, from: Square): Square[] {
  const board = parseFenBoard(fen);
  const piece = board[index(from)];
  if (!piece) return [];
  const f = FILES.indexOf(from[0]);
  const r = Number(from[1]) - 1;
  const out = new Set<Square>();
  const add = (s: Square | null) => {
    if (s && s !== from) out.add(s);
  };
  const ray = (df: number, dr: number) => {
    for (let i = 1; i < 8; i++) add(at(f + df * i, r + dr * i));
  };
  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      const startRank = piece.color === 'w' ? 1 : 6;
      add(at(f, r + dir));
      if (r === startRank) add(at(f, r + 2 * dir));
      add(at(f - 1, r + dir));
      add(at(f + 1, r + dir));
      break;
    }
    case 'n':
      for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) add(at(f + df, r + dr));
      break;
    case 'b':
      ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1);
      break;
    case 'r':
      ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1);
      break;
    case 'q':
      ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1); ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1);
      break;
    case 'k': {
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (df || dr) add(at(f + df, r + dr));
      const rights = fen.trim().split(/\s+/)[2] ?? '-';
      const home = piece.color === 'w' ? 'e1' : 'e8';
      if (from === home) {
        const [k, q] = piece.color === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (rights.includes(k)) add(at(6, r));
        if (rights.includes(q)) add(at(2, r));
      }
      break;
    }
  }
  return [...out];
}

/** A premove as UCI (`e7e8q` when it promotes), ready for `zhess.play` once it is this side's turn. */
export function premoveUci(pm: { from: Square; to: Square; promotion?: string }): Uci {
  return `${pm.from}${pm.to}${pm.promotion ?? ''}`;
}
