/**
 * Draw offers to the computer (DESIGN 8.3).
 *
 * The computer accepts when the game is past move 30 and the engine's evaluation is within
 * ±`DRAW_MAX_CP` (0.3 pawns); otherwise the page shows `Declined`. The computer itself never offers a
 * draw and never resigns.
 *
 * "Past move 30" means 30 full moves have been completed: the FEN move number at the cursor is 31
 * or higher. A game continued from a position counts from that position's move number.
 */
import type { EngineApi, Eval, Game } from './types';
import { moveNumber } from './zhess';

/** The game must be past this full move (DESIGN 8.3). */
export const DRAW_MIN_MOVES = 30;
/** Accept when |evaluation| ≤ this many centipawns (DESIGN 8.3: ±0.3 pawns). */
export const DRAW_MAX_CP = 30;
/** Depth of the evaluation behind the answer. */
export const DRAW_EVAL_DEPTH = 12;
/** No answer from the engine within this long declines. */
export const DRAW_EVAL_TIMEOUT_MS = 3000;

export type DrawAnswer = 'accept' | 'decline';

/** True when `DRAW_MIN_MOVES` full moves have been completed at the cursor. */
export function pastDrawMove(g: Game, minMoves = DRAW_MIN_MOVES): boolean {
  return moveNumber(g) > minMoves;
}

/**
 * The computer's answer for a position and its evaluation (from either side; only the size counts).
 * A finished game, a mate score or a missing evaluation declines.
 */
export function drawAnswer(g: Game, e: Eval | null): DrawAnswer {
  if (g.end || !pastDrawMove(g) || !e) return 'decline';
  if (e.mate !== undefined) return 'decline';
  return Math.abs(e.cp ?? 0) <= DRAW_MAX_CP ? 'accept' : 'decline';
}

export interface DrawOfferOptions {
  depth?: number;
  timeoutMs?: number;
}

/**
 * Asks the engine and answers. Before move 30 the engine is not asked at all. Never rejects:
 * an engine failure or timeout declines. The caller ends the game as `agreed` on `accept`
 * (`useGameState.finish({ result: '1/2-1/2', by: 'agreed' })`) and shows `assist.drawDeclined`
 * otherwise; it should ignore the answer if the game changed meanwhile.
 */
export async function askComputerDraw(
  engine: Pick<EngineApi, 'evaluate'>,
  g: Game,
  opts: DrawOfferOptions = {},
): Promise<DrawAnswer> {
  if (g.end || !pastDrawMove(g)) return 'decline';
  let e: Eval | null = null;
  try {
    e = await engine.evaluate(g.fen, opts.depth ?? DRAW_EVAL_DEPTH, opts.timeoutMs ?? DRAW_EVAL_TIMEOUT_MS);
  } catch {
    e = null;
  }
  return drawAnswer(g, e);
}
