/**
 * Premove state machine (DESIGN 6.3). Pure: no React, no DOM.
 *
 * - Only in timed games against the computer or in a room (`premoveAllowed`).
 * - One move can be queued during the opponent's turn. The board (package 1A) collects it and
 *   draws it with dashed rings from its `premove` prop; this module decides what happens to it.
 * - When the opponent has moved, the premove plays at once if it is legal in the new position
 *   (`settle` returns its canonical UCI), otherwise it is dropped silently.
 * - Any other change of the game (undo, takeback, a new game, the game ending, review) drops it.
 * - Tapping anywhere cancels it (the board calls `onPremove(null)` → `cancel`).
 * - Premoves bypass the blunder guard: the caller plays the returned UCI directly.
 */
import { flags } from './flags';
import type { Color, Game, Mode, PromotionPiece, Square, TcString, TimeControl, Uci } from './types';
import { legalMoves } from './zhess';

/** A queued move, as the board reports it (`Premove` of `components/board`). */
export interface QueuedMove {
  readonly from: Square;
  readonly to: Square;
  /** Promotion piece; absent means queen (DESIGN 6.2). */
  readonly promotion?: PromotionPiece;
}

/** The machine's state: the queued move and the position it was queued in. */
export interface PremoveState {
  readonly move: QueuedMove | null;
  /** Cursor of the game when the move was queued (the opponent was to move there). */
  readonly at: number;
  /** UCI of the ply before `at` ('' at the start), so a different game of equal length is told apart. */
  readonly tail: string;
  /** Optional session key (game id); a change drops the premove. */
  readonly key: string | null;
}

/** Nothing queued. */
export const NO_PREMOVE: PremoveState = Object.freeze({ move: null, at: -1, tail: '', key: null });

export interface PremoveContext {
  readonly mode: Mode;
  /** Time control of the game; premoves exist only with a clock. */
  readonly tc: TimeControl | TcString | null;
  /** False in review, on the start screen, or while a room is locked. Default true. */
  readonly live?: boolean;
}

/** DESIGN 6.3: premoves only in timed games against the computer or in a room (and when the flag is on). */
export function premoveAllowed(ctx: PremoveContext): boolean {
  if (!flags.premove) return false;
  if (ctx.live === false) return false;
  if (ctx.mode !== 'computer' && ctx.mode !== 'room') return false;
  if (!ctx.tc) return false;
  if (typeof ctx.tc === 'string') return /^\d+(?:\.\d+)?\+\d+(?:\.\d+)?$/.test(ctx.tc.trim());
  return ctx.tc.baseMs > 0;
}

function tailOf(g: Game): string {
  return g.cursor > 0 ? g.plies[g.cursor - 1].m : '';
}

/**
 * Queues `move` for `player` (replacing any earlier one). Ignored (state unchanged) when it is the
 * player's own turn or the game is over; then the move should be played normally instead.
 */
export function queue(state: PremoveState, g: Game, player: Color, move: QueuedMove, key: string | null = null): PremoveState {
  if (g.end || g.turn === player) return state;
  return { move: { ...move }, at: g.cursor, tail: tailOf(g), key };
}

/** Cancels the queued move (a tap anywhere, Escape, leaving the game). */
export function cancel(): PremoveState {
  return NO_PREMOVE;
}

/** UCI of a queued move as the board would play it (`e7e8q` when it promotes). */
export function queuedUci(move: QueuedMove): Uci {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

/**
 * The canonical UCI of `move` if it is legal for the side to move in `g`, else null. A pawn move
 * to the last rank without a piece promotes to a queen.
 */
export function legalPremove(g: Game, move: QueuedMove): Uci | null {
  if (g.end) return null;
  const options = legalMoves(g, move.from).filter((m) => m.to === move.to);
  if (options.length === 0) return null;
  if (options.some((m) => m.promotion)) {
    const want = move.promotion ?? 'q';
    return options.find((m) => m.promotion === want)?.uci ?? null;
  }
  return options[0].uci;
}

/** Result of looking at a new game value with a premove queued. */
export interface Settled {
  /** The state after this step: empty after a fire or a drop, unchanged while still waiting. */
  readonly state: PremoveState;
  /** The move to play now (canonical UCI), or null. */
  readonly fire: Uci | null;
  /** Why the state changed (for tests and logging); `wait` = still the opponent's turn. */
  readonly outcome: 'idle' | 'wait' | 'fire' | 'drop';
}

/**
 * Call on every new game value. If exactly the opponent's move has been added since the premove
 * was queued and it is now `player`'s turn, the premove fires when legal and is dropped when not.
 * Any other change (undo, redo, takeback, a new game, game over) drops it. Without a change it waits.
 */
export function settle(state: PremoveState, g: Game, player: Color, key: string | null = null): Settled {
  const { move } = state;
  if (!move) return { state, fire: null, outcome: 'idle' };
  const drop: Settled = { state: NO_PREMOVE, fire: null, outcome: 'drop' };
  if (key !== state.key || g.end) return drop;
  if (g.cursor === state.at) {
    // Same position as when queued (or a different game of the same length).
    return tailOf(g) === state.tail && g.turn !== player ? { state, fire: null, outcome: 'wait' } : drop;
  }
  if (g.cursor !== state.at + 1 || g.turn !== player) return drop;
  const prev = state.at > 0 ? g.plies[state.at - 1].m : '';
  if (prev !== state.tail) return drop;
  const uci = legalPremove(g, move);
  return uci ? { state: NO_PREMOVE, fire: uci, outcome: 'fire' } : drop;
}
