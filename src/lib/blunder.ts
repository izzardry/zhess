/**
 * Blunder guard rules (DESIGN 7.2), pure: no React, no engine, no timers.
 *
 * - `judgeEvals` decides from two engine evaluations: the position before the player's move (player
 *   to move) and the position after it (opponent to move). A move is flagged when it drops the
 *   evaluation by `BLUNDER_DROP_CP` or more, or allows a forced mate within `BLUNDER_MATE_MOVES`
 *   that was not already there.
 * - `fallbackVerdict` is the engine-free check (PLAN 7, DESIGN 17 risk 5): chess.js only, mate in 1
 *   and a crude hanging-piece count. It is used when the engine is not ready at drop time.
 * - `isConfirmation` is the 5-second confirm window: the same move in the same position again
 *   within `CONFIRM_WINDOW_MS` of its refusal commits.
 *
 * Scores are compared after clamping to ±`DECISIVE_CP`, so a player who is already winning big is
 * not nagged for winning a little less (mate in 3 → +12 is not a blunder), while giving away a
 * queen at +20 still is.
 */
import { Chess, type Square as ChessSquare } from 'chess.js';
import type { Color, Eval, Square, Uci } from './types';
import { negateEval, scoreCp } from './engine/uci';
import { allowsMateIn1, legalUci } from './levels';

/** A move is a blunder when it costs at least this many centipawns (DESIGN 7.2: 3 pawns). */
export const BLUNDER_DROP_CP = 300;
/** …or allows a forced mate within this many moves that was not already there (DESIGN 7.2). */
export const BLUNDER_MATE_MOVES = 2;
/** Scores are clamped to ±this before the drop is measured (a mate counts as this much). */
export const DECISIVE_CP = 1000;
/** Fixed search depth of both guard evaluations. */
export const GUARD_DEPTH = 8;
/** The check must finish within about this long after the drop, or the move goes through (DESIGN 7.2). */
export const GUARD_BUDGET_MS = 150;
/** Playing a refused move again within this window commits it (DESIGN 7.2). */
export const CONFIRM_WINDOW_MS = 5000;
/** Timeout of the "before" evaluation started when the player's turn begins (includes engine loading). */
export const BEFORE_TIMEOUT_MS = 15_000;

export type BlunderReason = 'drop' | 'mate' | 'mate-in-1' | 'hanging';

export interface Verdict {
  readonly flag: boolean;
  readonly reason?: BlunderReason;
  /** Clamped drop in centipawns (engine verdicts) or material loss in centipawns (fallback). */
  readonly dropCp?: number;
}

const OK: Verdict = Object.freeze({ flag: false });

/** Score of an evaluation from its side to move, clamped to ±`DECISIVE_CP`. */
export function clampScore(e: Eval): number {
  return Math.max(-DECISIVE_CP, Math.min(DECISIVE_CP, scoreCp(e)));
}

/**
 * Verdict from the engine.
 * @param before evaluation of the position before the move, from the player's side (null: unknown).
 * @param after evaluation of the position after the move, from the OPPONENT's side (null: no answer).
 *
 * - No `after` → allow (the engine was late).
 * - The move mates (`after` is mate 0) → allow.
 * - `after` says the opponent mates in 1..`BLUNDER_MATE_MOVES` and `before` did not already say the
 *   player is being mated → `mate`.
 * - With `before`: clamped(before) − clamped(after from the player's side) ≥ `BLUNDER_DROP_CP` → `drop`.
 */
export function judgeEvals(before: Eval | null, after: Eval | null): Verdict {
  if (!after) return OK;
  if (after.mate === 0) return OK;
  const alreadyLost = !!before && before.mate !== undefined && before.mate < 0;
  if (after.mate !== undefined && after.mate > 0 && after.mate <= BLUNDER_MATE_MOVES && !alreadyLost) {
    return { flag: true, reason: 'mate', dropCp: before ? clampScore(before) + DECISIVE_CP : undefined };
  }
  if (!before) return OK;
  const drop = clampScore(before) - clampScore(negateEval(after));
  return drop >= BLUNDER_DROP_CP ? { flag: true, reason: 'drop', dropCp: drop } : { flag: false, dropCp: drop };
}

/* ------------------------------------------------------------------------------------------------
 * Fallback without the engine (chess.js only)
 * --------------------------------------------------------------------------------------------- */

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function parts(uci: Uci): { from: ChessSquare; to: ChessSquare; promotion?: string } {
  const out: { from: ChessSquare; to: ChessSquare; promotion?: string } = {
    from: uci.slice(0, 2) as ChessSquare,
    to: uci.slice(2, 4) as ChessSquare,
  };
  if (uci.length > 4) out.promotion = uci[4];
  return out;
}

/**
 * Best material the side to move in `c` can win with one capture, in pawns: an undefended piece is
 * won whole; a defended one for the difference to the capturing piece (never below 0). Kings only
 * ever take undefended pieces (chess.js forbids the rest).
 */
function bestCaptureGain(c: Chess): number {
  const taker = c.turn();
  const victim: Color = taker === 'w' ? 'b' : 'w';
  let best = 0;
  for (const m of c.moves({ verbose: true })) {
    if (!m.captured) continue;
    const v = VALUE[m.captured] ?? 0;
    if (v <= best) continue;
    const a = VALUE[m.piece] ?? 0;
    c.move({ from: m.from, to: m.to, promotion: m.promotion });
    // En passant: the captured pawn was not on `to`, but the recapture square is `to` either way.
    const defended = c.isAttacked(m.to, victim);
    c.undo();
    const gain = defended ? Math.max(0, v - a) : v;
    if (gain > best) best = gain;
  }
  return best;
}

/**
 * Net material the mover gives away with `uci`, in pawns: the opponent's best one-capture gain
 * afterwards minus what the move itself won (capture, promotion). null when the move is illegal.
 */
export function materialRisk(fen: string, uci: Uci): number | null {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return null;
  }
  let gained = 0;
  try {
    const m = c.move(parts(uci));
    gained = (m.captured ? (VALUE[m.captured] ?? 0) : 0) + (m.promotion ? (VALUE[m.promotion] ?? 0) - 1 : 0);
  } catch {
    return null;
  }
  if (c.isGameOver()) return -gained;
  return bestCaptureGain(c) - gained;
}

/**
 * Engine-free verdict for `uci` played in `fen` (PLAN 7):
 * - the move allows a mate in 1 while another legal move does not → `mate-in-1`;
 * - the move gives away at least 3 pawns of material (`materialRisk`) and some other legal move
 *   gives away at least 3 pawns less → `hanging`.
 * A move that mates, or an illegal move, is never flagged.
 */
export function fallbackVerdict(fen: string, uci: Uci): Verdict {
  let c: Chess;
  try {
    c = new Chess(fen);
    c.move(parts(uci));
  } catch {
    return OK;
  }
  if (c.isCheckmate()) return OK;
  const moves = legalUci(fen);
  if (allowsMateIn1(fen, uci) && moves.some((m) => m !== uci && !allowsMateIn1(fen, m))) {
    return { flag: true, reason: 'mate-in-1' };
  }
  const risk = materialRisk(fen, uci);
  const threshold = BLUNDER_DROP_CP / 100;
  if (risk === null || risk < threshold) return { flag: false, dropCp: Math.max(0, (risk ?? 0) * 100) };
  let bestOther = Infinity;
  for (const m of moves) {
    if (m === uci) continue;
    const r = materialRisk(fen, m);
    if (r !== null && r < bestOther) bestOther = r;
    if (bestOther <= risk - threshold) break;
  }
  return risk - bestOther >= threshold
    ? { flag: true, reason: 'hanging', dropCp: (risk - bestOther) * 100 }
    : { flag: false, dropCp: Math.max(0, (risk - bestOther) * 100) };
}

/* ------------------------------------------------------------------------------------------------
 * Confirm window
 * --------------------------------------------------------------------------------------------- */

/** The last refused move: position, canonical UCI and when it was refused. */
export interface Refusal {
  readonly fen: string;
  readonly uci: Uci;
  readonly at: number;
}

/** True when `uci` in `fen` repeats the refused move within `windowMs` of its refusal: commit it. */
export function isConfirmation(
  r: Refusal | null,
  fen: string,
  uci: Uci,
  now: number,
  windowMs = CONFIRM_WINDOW_MS,
): boolean {
  return !!r && r.fen === fen && r.uci === uci && now - r.at >= 0 && now - r.at <= windowMs;
}

/** The square a refused move's piece returns to and pulses on (its from-square). */
export function refusedSquare(uci: Uci): Square {
  return uci.slice(0, 2) as Square;
}
