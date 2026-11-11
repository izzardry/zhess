/**
 * Computer levels (DESIGN 10.2) and the humanized move picker.
 *
 * Pure: no engine, no timers, no `Math.random`. The picker takes the MultiPV lines of a search,
 * the position, the level and an injected `rng`, and returns the move to play.
 *
 * Who does what:
 * - Levels 1–4 ("humanized"): the engine runs a MultiPV search at the table's depth; `pickMove`
 *   chooses at random (uniformly) among the lines within the level's error budget of the best.
 * - Levels 5–11: the engine plays with its UCI `Skill Level` for the table's move time. If a build
 *   has no `Skill Level` option, `humanizedPlan(level, false)` returns MultiPV parameters with
 *   shrinking budgets that emulate it (PLAN 7).
 * - Level 12: full strength, 3000 ms, or 1/30 of its remaining clock if that is longer.
 * - Every level respects its own clock in timed games (`engineMovetime`, `clockCapMs`).
 * - From level 3 upward the computer never walks into a mate in 1 when it has another move
 *   (`allowsMateIn1`; the engine bridge re-checks skill-level moves the same way).
 * - Level 1 captures a hanging queen only half the time.
 * - The minimum reply time of 400 ms (`MIN_REPLY_MS`) is the CALLER's job: start a timer when the
 *   computer's turn begins and play the move at max(search done, start + 400 ms).
 *
 * Imports carry explicit `.ts` extensions so that Node can load this file for `scripts/selfplay.mjs`.
 */
import { Chess, type Square as ChessSquare } from 'chess.js';
import type { Color, Eval, Uci } from './types';
import { MATE_CP, scoreCp, type PvLine } from './engine/uci.ts';

/** Default level of a new computer game (DESIGN 10.2). */
export const DEFAULT_LEVEL = 5;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 12;

/** The computer never answers faster than this (DESIGN 10.2). Enforced by the caller, not the engine. */
export const MIN_REPLY_MS = 400;

/** From this level upward the computer never walks into a mate in 1 when another move exists. */
export const NEVER_MATE_IN_1_FROM = 3;

/** Level 1 takes a hanging queen with this probability. */
export const HANGING_QUEEN_TAKE_RATE = 0.5;

/** Shortest move time ever asked of the engine in a timed game. */
export const MIN_MOVETIME_MS = 50;

export interface LevelSpec {
  readonly level: number;
  /** English name, for logs and scripts. The UI uses `levelKey()` from `lib/i18n/core`. */
  readonly name: string;
  readonly method: 'humanized' | 'skill';
  /** Humanized: MultiPV lines searched. */
  readonly multiPv?: number;
  /** Humanized: search depth. */
  readonly depth?: number;
  /** Humanized: a line is playable when it is at most this many centipawns worse than the best. */
  readonly budgetCp?: number;
  /** Skill: UCI `Skill Level` (0–20). */
  readonly skill?: number;
  /** Skill: move time in ms. */
  readonly movetimeMs?: number;
  /** Level 12: think at least this fraction of the remaining clock when that is longer than `movetimeMs`. */
  readonly clockFraction?: number;
}

/** DESIGN 10.2, starting values to be tuned by play-testing. */
export const LEVELS: readonly LevelSpec[] = Object.freeze([
  { level: 1, name: 'Beginner', method: 'humanized', multiPv: 6, depth: 4, budgetCp: 400 },
  { level: 2, name: 'Novice', method: 'humanized', multiPv: 5, depth: 5, budgetCp: 300 },
  { level: 3, name: 'Easy', method: 'humanized', multiPv: 4, depth: 6, budgetCp: 200 },
  { level: 4, name: 'Casual', method: 'humanized', multiPv: 3, depth: 7, budgetCp: 120 },
  { level: 5, name: 'Medium', method: 'skill', skill: 3, movetimeMs: 200 },
  { level: 6, name: 'Moderate', method: 'skill', skill: 6, movetimeMs: 300 },
  { level: 7, name: 'Tricky', method: 'skill', skill: 9, movetimeMs: 400 },
  { level: 8, name: 'Hard', method: 'skill', skill: 12, movetimeMs: 500 },
  { level: 9, name: 'Tough', method: 'skill', skill: 15, movetimeMs: 700 },
  { level: 10, name: 'Expert', method: 'skill', skill: 18, movetimeMs: 1000 },
  { level: 11, name: 'Master', method: 'skill', skill: 20, movetimeMs: 1500 },
  { level: 12, name: 'Insane', method: 'skill', skill: 20, movetimeMs: 3000, clockFraction: 1 / 30 },
] satisfies LevelSpec[]);

/**
 * Emulation of levels 5–11 for an engine build without `Skill Level`: MultiPV search with
 * shrinking error budgets and growing depth. Not used by stockfish.js 19.0.1, which has the option.
 */
export const EMULATED_SKILL: Readonly<Record<number, { multiPv: number; depth: number; budgetCp: number }>> =
  Object.freeze({
    5: { multiPv: 4, depth: 8, budgetCp: 100 },
    6: { multiPv: 4, depth: 9, budgetCp: 75 },
    7: { multiPv: 4, depth: 10, budgetCp: 55 },
    8: { multiPv: 3, depth: 11, budgetCp: 40 },
    9: { multiPv: 3, depth: 12, budgetCp: 25 },
    10: { multiPv: 2, depth: 13, budgetCp: 12 },
    11: { multiPv: 2, depth: 14, budgetCp: 0 },
  });

/** Clamp to 1–12 (non-numbers become the default level). */
export function normalizeLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
}

export function levelSpec(level: number): LevelSpec {
  return LEVELS[normalizeLevel(level) - 1];
}

/**
 * The MultiPV plan for a level, or null when the level is played with `Skill Level` + move time.
 * `hasSkill` says whether the engine build offers the `Skill Level` option.
 */
export function humanizedPlan(
  level: number,
  hasSkill = true,
): { multiPv: number; depth: number; budgetCp: number } | null {
  const spec = levelSpec(level);
  if (spec.method === 'humanized') {
    return { multiPv: spec.multiPv ?? 1, depth: spec.depth ?? 1, budgetCp: spec.budgetCp ?? 0 };
  }
  if (!hasSkill && spec.level < MAX_LEVEL) return EMULATED_SKILL[spec.level] ?? null;
  return null;
}

/** Remaining clock of each side plus the increment, as `EngineApi.bestMove` receives it. */
export interface EngineClock {
  readonly wMs: number;
  readonly bMs: number;
  readonly incMs: number;
}

/**
 * Longest the engine may think in a timed game: 1/20 of its remaining time plus half the
 * increment, never below `MIN_MOVETIME_MS`. Infinity without a clock.
 */
export function clockCapMs(turn: Color, clock?: EngineClock | null): number {
  if (!clock) return Infinity;
  const mine = Math.max(0, turn === 'w' ? clock.wMs : clock.bMs);
  return Math.max(MIN_MOVETIME_MS, Math.floor(mine / 20 + Math.max(0, clock.incMs) / 2));
}

/**
 * Move time for a `Skill Level` search (levels 5–12): the table's time; level 12 takes 1/30 of its
 * remaining clock when that is longer; in timed games capped by `clockCapMs`. 0 for humanized levels
 * (they search to a fixed depth).
 */
export function engineMovetime(level: number, turn: Color, clock?: EngineClock | null): number {
  const spec = levelSpec(level);
  if (spec.method !== 'skill') return 0;
  let ms = spec.movetimeMs ?? 0;
  if (clock && spec.clockFraction) {
    const mine = Math.max(0, turn === 'w' ? clock.wMs : clock.bMs);
    ms = Math.max(ms, mine * spec.clockFraction);
  }
  return Math.round(Math.min(ms, clockCapMs(turn, clock)));
}

/* ------------------------------------------------------------------------------------------------
 * Position checks (chess.js)
 * --------------------------------------------------------------------------------------------- */

function uciParts(uci: Uci): { from: ChessSquare; to: ChessSquare; promotion?: string } {
  const out: { from: ChessSquare; to: ChessSquare; promotion?: string } = {
    from: uci.slice(0, 2) as ChessSquare,
    to: uci.slice(2, 4) as ChessSquare,
  };
  if (uci.length > 4) out.promotion = uci[4];
  return out;
}

/** Plays `uci` on a fresh board from `fen`; null when the FEN or the move is not legal. */
function after(fen: string, uci: Uci): Chess | null {
  try {
    const c = new Chess(fen);
    c.move(uciParts(uci));
    return c;
  } catch {
    return null;
  }
}

/** All legal moves of a position in UCI (chess.js generation order); empty for a bad FEN. */
export function legalUci(fen: string): Uci[] {
  try {
    return new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
  } catch {
    return [];
  }
}

/** True when, after `uci`, the opponent has a move that checkmates. A move that mates is never "into mate". */
export function allowsMateIn1(fen: string, uci: Uci): boolean {
  const c = after(fen, uci);
  if (!c || c.isGameOver()) return false;
  // chess.js marks mating moves with `#` in SAN; much cheaper than playing each reply.
  return c.moves().some((san) => san.endsWith('#'));
}

/**
 * True when `uci` captures the opponent's queen and that is a clear gain: the capturing piece is
 * not a queen (so even a defended queen is won for less), or the queen's square is not defended
 * after the capture.
 */
export function capturesHangingQueen(fen: string, uci: Uci): boolean {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return false;
  }
  const { from, to } = uciParts(uci);
  const mover = c.get(from);
  const target = c.get(to);
  if (!mover || !target || target.type !== 'q' || target.color === mover.color) return false;
  if (mover.type !== 'q') return true;
  try {
    c.move(uciParts(uci));
  } catch {
    return false;
  }
  return !c.isAttacked(to, target.color);
}

/* ------------------------------------------------------------------------------------------------
 * Picker
 * --------------------------------------------------------------------------------------------- */

function pickOne<T>(xs: readonly T[], rng: () => number): T {
  const r = rng();
  const i = Math.min(xs.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * xs.length)));
  return xs[i];
}

function byScore(lines: readonly PvLine[]): PvLine[] {
  // Stable: equal scores keep the engine's MultiPV order.
  return lines
    .map((l, i) => ({ l, i, s: scoreCp(l.eval) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.l);
}

/** What `pickMove` did, for tests and logs. */
export interface PickTrace {
  readonly move: Uci;
  /** Moves the choice was made from (after the safety filters and the budget). */
  readonly pool: readonly Uci[];
  readonly reason: 'budget' | 'hanging-queen' | 'only-safe' | 'all-lose';
}

/**
 * Choose the computer's move from the MultiPV `lines` of a search on `fen` (evals from the side to
 * move). `budgetCp` defaults to the level's (or its emulation's) budget.
 *
 * 1. From level 3: drop lines that allow a mate in 1. If every line does, play a random legal move
 *    that does not (`only-safe`); if none exists, keep the lines (`all-lose`).
 * 2. Level 1: if a line captures a hanging queen, take it with probability 1/2; otherwise drop such
 *    lines (when anything else remains) so the queen is really left alone.
 * 3. Uniformly at random among the remaining lines within `budgetCp` of the best remaining line.
 *
 * Throws when `lines` is empty (the position has no legal move).
 */
export function pickMoveTrace(
  fen: string,
  lines: readonly PvLine[],
  level: number,
  rng: () => number,
  budgetCp?: number,
): PickTrace {
  if (lines.length === 0) throw new Error('pickMove: no candidate moves');
  const lv = normalizeLevel(level);
  const budget = Math.max(0, budgetCp ?? humanizedPlan(lv, false)?.budgetCp ?? 0);
  let pool = byScore(lines);

  if (lv >= NEVER_MATE_IN_1_FROM) {
    const safe = pool.filter((l) => !allowsMateIn1(fen, l.uci));
    if (safe.length > 0) {
      pool = safe;
    } else {
      const listed = new Set(pool.map((l) => l.uci));
      const others = legalUci(fen).filter((m) => !listed.has(m) && !allowsMateIn1(fen, m));
      if (others.length > 0) return { move: pickOne(others, rng), pool: others, reason: 'only-safe' };
      return { move: pool[0].uci, pool: [pool[0].uci], reason: 'all-lose' };
    }
  }

  if (lv === 1) {
    const hanging = pool.filter((l) => capturesHangingQueen(fen, l.uci));
    if (hanging.length > 0) {
      if (rng() < HANGING_QUEEN_TAKE_RATE) {
        return { move: hanging[0].uci, pool: hanging.map((l) => l.uci), reason: 'hanging-queen' };
      }
      const rest = pool.filter((l) => !hanging.includes(l));
      if (rest.length > 0) pool = rest;
    }
  }

  const best = scoreCp(pool[0].eval);
  const within = pool.filter((l) => best - scoreCp(l.eval) <= budget);
  const chosen = pickOne(within, rng);
  return { move: chosen.uci, pool: within.map((l) => l.uci), reason: 'budget' };
}

/** `pickMoveTrace(...).move`. */
export function pickMove(
  fen: string,
  lines: readonly PvLine[],
  level: number,
  rng: () => number,
  budgetCp?: number,
): Uci {
  return pickMoveTrace(fen, lines, level, rng, budgetCp).move;
}

/** True when an evaluation is a mate score (either side). */
export function isMate(e: Eval): boolean {
  return e.mate !== undefined || Math.abs(e.cp ?? 0) >= MATE_CP;
}
