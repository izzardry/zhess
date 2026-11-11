/**
 * Zhess rules wrapper over chess.js (DESIGN 8.1, 13.2, 11).
 *
 * Pure: no React, no DOM. `Game` values are frozen plain objects; every operation returns a new
 * one. A chess.js instance positioned at a game's cursor is cached per value in a WeakMap and
 * handed on to the next value when a game moves forward or back, so long games do not replay
 * from the start on every move. The cache is invisible: a game rebuilt from JSON works the same.
 */
import { Chess, DEFAULT_POSITION, validateFen, type Move as ChessMove } from 'chess.js';
import type {
  Color,
  Game,
  GameEnd,
  Material,
  Move,
  PgnMeta,
  Piece,
  PieceType,
  Ply,
  PromotionPiece,
  Result,
  Square,
  Termination,
  TimeControl,
  Uci,
  ZhessApi,
} from './types';

/* ---------------------------------------------------------------------------------------------- */
/* Squares                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

const FILES = 'abcdefgh';

/** All 64 squares in index order: a1 = 0, b1 = 1, … h1 = 7, a2 = 8, … h8 = 63. */
export const SQUARES: readonly Square[] = Object.freeze(
  Array.from({ length: 64 }, (_, i) => `${FILES[i % 8]}${Math.floor(i / 8) + 1}` as Square),
);

/** Index of a square: file + 8 × rank (a1 = 0, h8 = 63). */
export function squareIndex(sq: Square): number {
  return FILES.indexOf(sq[0]) + 8 * (Number(sq[1]) - 1);
}

/** Square at an index 0..63. */
export function squareName(i: number): Square {
  const sq = SQUARES[i];
  if (!sq) throw new RangeError(`Bad square index: ${i}`);
  return sq;
}

/** Type guard for square names. */
export function isSquare(s: string): s is Square {
  return /^[a-h][1-8]$/.test(s);
}

/** The standard start position. */
export const START_FEN = DEFAULT_POSITION;

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/* ---------------------------------------------------------------------------------------------- */
/* Time controls                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/** `{ baseMs: 300000, incMs: 0 }` → `5+0`; null → null. Fractional minutes keep up to 2 decimals. */
export function formatTc(tc: TimeControl): string | null {
  if (!tc) return null;
  const min = Math.round((tc.baseMs / 60000) * 100) / 100;
  const inc = Math.round((tc.incMs / 1000) * 100) / 100;
  return `${min}+${inc}`;
}

/** `5+0` → `{ baseMs: 300000, incMs: 0 }`. Anything else (including null, `off`) → null. */
export function parseTc(s: string | null | undefined): TimeControl {
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  const baseMs = Math.round(Number(m[1]) * 60000);
  const incMs = Math.round(Number(m[2]) * 1000);
  if (!(baseMs > 0)) return null;
  return { baseMs, incMs };
}

/* ---------------------------------------------------------------------------------------------- */
/* Move codec (DESIGN 13.2)                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** base64url alphabet; symbol i stands for square index i. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/;

function parseUci(uci: string): { from: Square; to: Square; promotion?: PromotionPiece } | null {
  const m = UCI_RE.exec(uci.trim());
  if (!m) return null;
  return {
    from: m[1] as Square,
    to: m[2] as Square,
    promotion: m[3] ? (m[3].toLowerCase() as PromotionPiece) : undefined,
  };
}

/** Two base64url characters per ply (from, to); `.r` `.b` `.n` for non-queen promotions. */
export function encodeMoves(plies: readonly Ply[]): string {
  let out = '';
  for (const p of plies) {
    const u = parseUci(p.m);
    if (!u) throw new Error(`Bad UCI: ${p.m}`);
    out += B64[squareIndex(u.from)] + B64[squareIndex(u.to)];
    if (u.promotion && u.promotion !== 'q') out += '.' + u.promotion;
  }
  return out;
}

/** Inverse of `encodeMoves`. Queen promotions come back as 4-character UCI. Throws on malformed input. */
export function decodeMoves(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const a = B64.indexOf(s[i]);
    const b = i + 1 < s.length ? B64.indexOf(s[i + 1]) : -1;
    if (a < 0 || b < 0) throw new Error(`Bad move encoding at ${i}`);
    let uci = SQUARES[a] + SQUARES[b];
    i += 2;
    if (s[i] === '.') {
      const p = s[i + 1];
      if (p !== 'r' && p !== 'b' && p !== 'n') throw new Error(`Bad promotion at ${i}`);
      uci += p;
      i += 2;
    }
    out.push(uci);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* chess.js instance cache                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const cache = new WeakMap<Game, Chess>();

function build(start: string, plies: readonly Ply[], count: number): Chess {
  const c = new Chess(start);
  for (let i = 0; i < count; i++) {
    const u = parseUci(plies[i].m);
    if (!u) throw new Error(`Bad UCI in game record: ${plies[i].m}`);
    c.move(u);
  }
  return c;
}

/** The game's instance for reading. Do not mutate it. */
function peek(g: Game): Chess {
  let c = cache.get(g);
  if (!c) {
    c = build(g.start, g.plies, g.cursor);
    cache.set(g, c);
  }
  return c;
}

/** The game's instance for mutation: removed from the cache (g rebuilds lazily if used again). */
function take(g: Game): Chess {
  const c = cache.get(g);
  if (c) {
    cache.delete(g);
    return c;
  }
  return build(g.start, g.plies, g.cursor);
}

/** Creates a frozen game value and caches its instance. */
function make(start: string, plies: readonly Ply[], cursor: number, c: Chess, end: GameEnd | undefined): Game {
  const g: Game = Object.freeze({
    start,
    plies,
    cursor,
    fen: c.fen(),
    turn: c.turn(),
    ...(end ? { end: Object.freeze({ result: end.result, by: end.by }) } : {}),
  });
  cache.set(g, c);
  return g;
}

/** Automatic endings of DESIGN 8.2 at the instance's position. */
function autoEnd(c: Chess): GameEnd | undefined {
  if (c.isCheckmate()) return { result: c.turn() === 'w' ? '0-1' : '1-0', by: 'mate' };
  if (c.isStalemate()) return { result: '1/2-1/2', by: 'stalemate' };
  if (c.isInsufficientMaterial()) return { result: '1/2-1/2', by: 'material' };
  if (c.isThreefoldRepetition()) return { result: '1/2-1/2', by: 'repetition' };
  if (c.isDrawByFiftyMoves()) return { result: '1/2-1/2', by: 'fifty' };
  return undefined;
}

const AUTO: ReadonlySet<Termination> = new Set<Termination>(['mate', 'stalemate', 'material', 'repetition', 'fifty']);

/* ---------------------------------------------------------------------------------------------- */
/* Conversions                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

function toMove(m: ChessMove): Move {
  const out: {
    -readonly [K in keyof Move]: Move[K];
  } = {
    from: m.from,
    to: m.to,
    uci: m.lan,
    san: m.san,
    color: m.color,
    piece: m.piece,
  };
  if (m.captured) out.captured = m.captured;
  if (m.promotion) out.promotion = m.promotion as PromotionPiece;
  if (m.isKingsideCastle()) out.castle = 'k';
  else if (m.isQueensideCastle()) out.castle = 'q';
  if (m.isEnPassant()) out.enPassant = true;
  return out;
}

/**
 * Resolves a requested UCI move against the legal moves of `c`: adds the queen to a bare
 * promotion and maps a king dropped on its own rook to castling. Returns null if illegal.
 */
function resolve(c: Chess, uci: string): ChessMove | null {
  const u = parseUci(uci);
  if (!u) return null;
  const legal = c.moves({ verbose: true, square: u.from });
  const direct = legal.filter((m) => m.to === u.to);
  if (direct.length) {
    if (direct.some((m) => m.promotion)) {
      const want = u.promotion ?? 'q';
      return direct.find((m) => m.promotion === want) ?? null;
    }
    return u.promotion ? null : direct[0];
  }
  // King onto its own rook = castle toward that rook (DESIGN 6.1).
  const piece = c.get(u.from);
  const target = c.get(u.to);
  if (piece?.type === 'k' && target?.type === 'r' && target.color === piece.color && !u.promotion) {
    const kingside = u.to[0] > u.from[0];
    return legal.find((m) => (kingside ? m.isKingsideCastle() : m.isQueensideCastle())) ?? null;
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Game operations                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

export function newGame(startFen?: string): Game {
  const start = startFen ?? START_FEN;
  const check = validateFen(start);
  if (!check.ok) throw new Error(`Invalid FEN: ${check.error ?? start}`);
  const c = new Chess(start);
  return make(start, Object.freeze([]), 0, c, autoEnd(c));
}

export function legalMoves(g: Game, from?: Square): Move[] {
  if (g.end) return [];
  const c = peek(g);
  const ms = from ? c.moves({ verbose: true, square: from }) : c.moves({ verbose: true });
  return ms.map(toMove);
}

export function play(g: Game, uci: string, ms: number): Game {
  if (g.end) throw new Error('Game is over');
  const probe = peek(g);
  const mv = resolve(probe, uci);
  if (!mv) throw new Error(`Illegal move: ${uci}`);
  const c = take(g);
  c.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  const ply: Ply = Object.freeze({ m: mv.lan, ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0 });
  const plies = Object.freeze([...g.plies.slice(0, g.cursor), ply]);
  return make(g.start, plies, plies.length, c, autoEnd(c));
}

export function undo(g: Game, n: number): Game {
  const target = Math.max(0, g.cursor - Math.max(0, Math.floor(n)));
  if (target === g.cursor) return g;
  const c = take(g);
  for (let i = g.cursor; i > target; i--) c.undo();
  return make(g.start, g.plies, target, c, autoEnd(c));
}

export function redo(g: Game, n: number): Game {
  const target = Math.min(g.plies.length, g.cursor + Math.max(0, Math.floor(n)));
  if (target === g.cursor) return g;
  const c = take(g);
  for (let i = g.cursor; i < target; i++) {
    const u = parseUci(g.plies[i].m);
    if (!u) throw new Error(`Bad UCI in game record: ${g.plies[i].m}`);
    c.move(u);
  }
  return make(g.start, g.plies, target, c, autoEnd(c));
}

export function goto(g: Game, cursor: number): Game {
  const target = Math.min(g.plies.length, Math.max(0, Math.floor(cursor)));
  if (target === g.cursor) return g;
  const c = take(g);
  if (target < g.cursor) {
    for (let i = g.cursor; i > target; i--) c.undo();
  } else {
    for (let i = g.cursor; i < target; i++) {
      const u = parseUci(g.plies[i].m);
      if (!u) throw new Error(`Bad UCI in game record: ${g.plies[i].m}`);
      c.move(u);
    }
  }
  return make(g.start, g.plies, target, c, g.end);
}

export function end(g: Game, result: Result, by: Termination): Game {
  if (g.end) return g;
  const plies = g.cursor < g.plies.length ? Object.freeze(g.plies.slice(0, g.cursor)) : g.plies;
  return make(g.start, plies, g.cursor, take(g), { result, by });
}

export function reopen(g: Game): Game {
  if (!g.end || AUTO.has(g.end.by)) return g;
  return make(g.start, g.plies, g.cursor, take(g), undefined);
}

export function replay(plies: readonly Ply[], startFen?: string): Game {
  let g = newGame(startFen);
  for (const p of plies) g = play(g, p.m, p.ms);
  return g;
}

export function fromRecord(
  moves: string,
  ms: readonly number[],
  ending?: GameEnd,
  opts: { startFen?: string; lenient?: boolean } = {},
): Game {
  let ucis: string[];
  try {
    ucis = decodeMoves(moves);
  } catch (e) {
    if (!opts.lenient) throw e;
    ucis = decodeMoves(moves.slice(0, validPrefixLength(moves)));
  }
  let g = newGame(opts.startFen);
  for (let i = 0; i < ucis.length; i++) {
    try {
      g = play(g, ucis[i], Number.isFinite(ms[i]) ? ms[i] : 0);
    } catch (e) {
      if (!opts.lenient) throw e;
      return g;
    }
  }
  if (ending && !g.end) g = end(g, ending.result, ending.by);
  return g;
}

/** Length of the longest decodable prefix of an encoded move string. */
function validPrefixLength(s: string): number {
  let i = 0;
  let ok = 0;
  while (i + 1 < s.length && B64.includes(s[i]) && B64.includes(s[i + 1])) {
    i += 2;
    if (s[i] === '.') {
      const p = s[i + 1];
      if (p !== 'r' && p !== 'b' && p !== 'n') break;
      i += 2;
    }
    ok = i;
  }
  return ok;
}

/* ---------------------------------------------------------------------------------------------- */
/* Reading                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export function attacked(g: Game, by: Color): Square[] {
  const c = peek(g);
  return SQUARES.filter((sq) => c.isAttacked(sq, by));
}

export function inCheck(g: Game): Square | null {
  const c = peek(g);
  if (!c.inCheck()) return null;
  return c.findPiece({ type: 'k', color: c.turn() })[0] ?? null;
}

const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ORDER: Record<PieceType, number> = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

export function material(g: Game): Material {
  const c = peek(g);
  const captured: Record<Color, PieceType[]> = { w: [], b: [] };
  for (const m of history(g)) {
    if (m.captured) captured[m.color].push(m.captured);
  }
  captured.w.sort((a, b) => ORDER[a] - ORDER[b]);
  captured.b.sort((a, b) => ORDER[a] - ORDER[b]);
  let diff = 0;
  for (const row of c.board()) {
    for (const p of row) if (p) diff += p.color === 'w' ? VALUE[p.type] : -VALUE[p.type];
  }
  return { captured, diff };
}

export function san(g: Game): string[] {
  return peek(g).history();
}

/** Verbose history per game value (values are immutable, so it never goes stale). */
const historyCache = new WeakMap<Game, readonly Move[]>();

export function history(g: Game): Move[] {
  let h = historyCache.get(g);
  if (!h) {
    h = Object.freeze(peek(g).history({ verbose: true }).map(toMove));
    historyCache.set(g, h);
  }
  return [...h];
}

export function board(g: Game): ReadonlyArray<Piece | null> {
  const c = peek(g);
  return SQUARES.map((sq) => {
    const p = c.get(sq);
    return p ? { color: p.color, type: p.type } : null;
  });
}

export function lastMove(g: Game): { from: Square; to: Square } | null {
  if (g.cursor === 0) return null;
  const u = parseUci(g.plies[g.cursor - 1].m);
  return u ? { from: u.from, to: u.to } : null;
}

/** Side to move in a FEN (its second field). */
function fenTurn(fen: string): Color {
  return fen.split(/\s+/)[1] === 'b' ? 'b' : 'w';
}

export function colorOfPly(g: Game, i: number): Color {
  const first = fenTurn(g.start);
  return i % 2 === 0 ? first : other(first);
}

export function moveNumber(g: Game): number {
  return peek(g).moveNumber();
}

export function sanToUci(g: Game, text: string): Uci | null {
  if (g.end) return null;
  const t = text.trim();
  if (!t) return null;
  const c = peek(g);
  // UCI first (cheap and unambiguous).
  const viaUci = resolve(c, t);
  if (viaUci) return viaUci.lan;
  // SAN through chess.js's permissive parser, on a scratch copy. Accept 0-0 for O-O.
  const scratch = new Chess(c.fen());
  const castled = t.replace(/0/g, 'O');
  const candidates = [t, castled];
  // Lower-case piece letters typed in a hurry: nf3 → Nf3, bc4 → Bc4 (b is tried as a pawn file first).
  if (/^[nbrqk]/.test(castled)) candidates.push(castled[0].toUpperCase() + castled.slice(1));
  // A bare pawn move to the last rank promotes to a queen (DESIGN 6.2): a8 → a8=Q, bxa8 → bxa8=Q.
  if (/^[a-h](x[a-h])?[18][+#]?$/.test(castled)) candidates.push(castled.replace(/[+#]$/, '') + '=Q');
  for (const cand of candidates) {
    try {
      return scratch.move(cand).lan;
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

export function pgn(g: Game, meta: PgnMeta): string {
  const count = g.end ? g.plies.length : g.cursor;
  const c = new Chess(g.start);
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined && v !== '') c.setHeader(k, v);
  };
  set('Event', meta.event);
  set('Site', meta.site);
  set('Date', meta.date);
  set('Round', meta.round);
  set('White', meta.white);
  set('Black', meta.black);
  for (let i = 0; i < count; i++) {
    const u = parseUci(g.plies[i].m);
    if (!u) throw new Error(`Bad UCI in game record: ${g.plies[i].m}`);
    c.move(u);
  }
  c.setHeader('Result', g.end?.result ?? '*');
  if (meta.timeControl) {
    c.setHeader('TimeControl', `${Math.round(meta.timeControl.baseMs / 1000)}+${Math.round(meta.timeControl.incMs / 1000)}`);
  }
  if (g.end) c.setHeader('Termination', g.end.by === 'time' ? 'time forfeit' : 'normal');
  for (const [k, v] of Object.entries(meta.tags ?? {})) set(k, v);
  return c.pgn();
}

/* ---------------------------------------------------------------------------------------------- */
/* Clocks and time-outs (DESIGN 11, 9.8, 8.2)                                                       */
/* ---------------------------------------------------------------------------------------------- */

export function timeUsed(g: Game): Record<Color, number> {
  const used: Record<Color, number> = { w: 0, b: 0 };
  for (let i = 0; i < g.cursor; i++) used[colorOfPly(g, i)] += g.plies[i].ms;
  return used;
}

export function clocks(g: Game, tc: TimeControl): Record<Color, number> {
  if (!tc) return timeUsed(g);
  const left: Record<Color, number> = { w: tc.baseMs, b: tc.baseMs };
  const moved: Record<Color, boolean> = { w: false, b: false };
  for (let i = 0; i < g.cursor; i++) {
    const col = colorOfPly(g, i);
    if (!moved[col]) {
      // The first move of each side is untimed: it starts that side's clock.
      moved[col] = true;
      continue;
    }
    left[col] += tc.incMs - g.plies[i].ms;
  }
  return left;
}

export function clockRunning(g: Game): boolean {
  for (let i = 0; i < g.cursor; i++) if (colorOfPly(g, i) === g.turn) return true;
  return false;
}

/**
 * Whether `color` has material that could possibly deliver mate in this position, even with the
 * opponent's help (FIDE: a time-out against a side that cannot mate is a draw).
 * - A lone king never can.
 * - King + one knight can only when the other side has some piece to block its own king with.
 * - King + bishops all on one square color can only when the other side has a pawn, a knight, or a
 *   bishop on the other square color.
 * - Anything else (a pawn, rook, queen, two knights, knight + bishop, bishops on both colors) can.
 */
export function canMate(g: Game, color: Color): boolean {
  const c = peek(g);
  const own: { type: PieceType; sq: Square }[] = [];
  const opp: { type: PieceType; sq: Square }[] = [];
  for (const sq of SQUARES) {
    const p = c.get(sq);
    if (!p || p.type === 'k') continue;
    (p.color === color ? own : opp).push({ type: p.type, sq });
  }
  if (own.length === 0) return false;
  if (own.some((p) => p.type === 'p' || p.type === 'r' || p.type === 'q')) return true;
  const knights = own.filter((p) => p.type === 'n');
  const bishops = own.filter((p) => p.type === 'b');
  if (knights.length === 1 && bishops.length === 0) return opp.length > 0;
  if (knights.length === 0) {
    const shade = (sq: Square) => (FILES.indexOf(sq[0]) + Number(sq[1])) % 2;
    const shades = new Set(bishops.map((b) => shade(b.sq)));
    if (shades.size === 1) {
      const myShade = [...shades][0];
      const helps = opp.some((p) => p.type === 'p' || p.type === 'n' || (p.type === 'b' && shade(p.sq) !== myShade));
      return helps;
    }
  }
  return true;
}

export function timeoutResult(g: Game, flagged: Color): GameEnd {
  const winner = other(flagged);
  if (!canMate(g, winner)) return { result: '1/2-1/2', by: 'time' };
  return { result: winner === 'w' ? '1-0' : '0-1', by: 'time' };
}

export function timeout(g: Game, flagged: Color): Game {
  if (g.end) return g;
  const r = timeoutResult(g, flagged);
  return end(g, r.result, r.by);
}

/* ---------------------------------------------------------------------------------------------- */
/* The API object                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export const zhess: ZhessApi = {
  newGame,
  legalMoves,
  play,
  undo,
  redo,
  goto,
  end,
  attacked,
  inCheck,
  material,
  san,
  pgn,
  encodeMoves,
  decodeMoves,
  clocks,
  replay,
  fromRecord,
  reopen,
  timeout,
  timeoutResult,
  canMate,
  clockRunning,
  timeUsed,
  board,
  lastMove,
  history,
  colorOfPly,
  sanToUci,
  moveNumber,
};

export default zhess;
