/**
 * Pure game-session logic behind `useGameState` and `useSavedGames` (DESIGN 4.1, 10.3, 12, 13).
 *
 * No React, no DOM, no storage: every function takes what it needs (including `now`) and returns a
 * new value, so the rules are tested here without rendering anything.
 */
import { generateCode } from './codes';
import type {
  Color,
  ColorChoice,
  Game,
  GameEnd,
  Mode,
  Opponent,
  Ply,
  Rng,
  SavedGame,
  TcString,
} from './types';
import { normalizeTc } from './url';
import zhess from './zhess';

/* ---------------------------------------------------------------------------------------------- */
/* Settings                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** Default computer level (DESIGN 10.2). */
export const DEFAULT_LEVEL = 5;
/** First-run opponent: `COMPUTER 5 MEDIUM` (DESIGN 4.1). */
export const DEFAULT_OPPONENT: Opponent = Object.freeze({ mode: 'computer', level: DEFAULT_LEVEL });
/** Time a resumed game must stay open before its "last played" time moves (DESIGN 12.1, Ztyle 11). */
export const LAST_PLAYED_DELAY_MS = 15_000;
/** History cards shown before `N more games` (DESIGN 12.2). */
export const RECENT_COUNT = 5;

/** A level as an integer 1–12, or undefined. */
export function clampLevel(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.round(v);
  return n >= 1 && n <= 12 ? n : undefined;
}

/** Validates a stored opponent value (`zhess:opponent`); anything unreadable is the default. */
export function parseOpponent(v: unknown): Opponent {
  if (typeof v === 'object' && v !== null) {
    const o = v as { mode?: unknown; level?: unknown };
    if (o.mode === 'room') return { mode: 'room' };
    if (o.mode === 'local') return { mode: 'local' };
    if (o.mode === 'computer') return { mode: 'computer', level: clampLevel(o.level) ?? DEFAULT_LEVEL };
  }
  return DEFAULT_OPPONENT;
}

/** Validates a stored color choice (`zhess:color`). Default random. */
export function parseColorChoice(v: unknown): ColorChoice {
  return v === 'w' || v === 'b' ? v : 'random';
}

/** Value stored under `zhess:clock` for "clock off". */
export const CLOCK_OFF = 'off';

/** Validates a stored time control (`zhess:clock`): a normalized `m+s` string, or null for off. */
export function parseClockPref(v: unknown): TcString | null {
  return typeof v === 'string' ? (normalizeTc(v) ?? null) : null;
}

/** True for computer and pass-and-play. */
export function isSolo(o: Opponent | Mode): boolean {
  const mode = typeof o === 'string' ? o : o.mode;
  return mode !== 'room';
}

/** The opponent selector value that describes a game. */
export function opponentOf(g: { mode: Mode; level?: number }): Opponent {
  if (g.mode === 'room') return { mode: 'room' };
  if (g.mode === 'local') return { mode: 'local' };
  return { mode: 'computer', level: clampLevel(g.level) ?? DEFAULT_LEVEL };
}

/** This device's side for a new game: pass-and-play is always white; random flips a coin. */
export function resolveColor(choice: ColorChoice, mode: Mode, rng: Rng): Color {
  if (mode === 'local') return 'w';
  if (choice === 'w' || choice === 'b') return choice;
  return rng() < 0.5 ? 'w' : 'b';
}

/** A fresh code that no stored game uses yet (as its code or id). */
export function freshCode(games: readonly SavedGame[], rng: Rng): string {
  const taken = new Set<string>();
  for (const g of games) {
    taken.add(g.code);
    taken.add(g.id);
  }
  for (let i = 0; i < 50; i++) {
    const c = generateCode(rng);
    if (!taken.has(c)) return c;
  }
  return generateCode(rng);
}

/* ---------------------------------------------------------------------------------------------- */
/* Undo / redo rules (DESIGN 4.2, 10.3)                                                             */
/* ---------------------------------------------------------------------------------------------- */

/**
 * How the undo slot behaves in a mode:
 * - `ply`: pass-and-play, one half-move;
 * - `turn`: against the computer, one full turn (the computer's reply and the player's move);
 * - `request`: in a room, a takeback request (handled by the room controller, not here).
 */
export type UndoRule = 'ply' | 'turn' | 'request';

export function undoRuleFor(mode: Mode): UndoRule {
  return mode === 'local' ? 'ply' : mode === 'computer' ? 'turn' : 'request';
}

/** Side to move after `cursor` plies of `g`. */
export function turnAt(g: Game, cursor: number): Color {
  return zhess.colorOfPly(g, cursor);
}

/**
 * Cursor that undo goes back to, or `g.cursor` when there is nothing to undo.
 * - `ply`: one back.
 * - `turn` (player `color`): back to the latest earlier position where the player is to move, so
 *   a computer reply and the player's move go together; when the computer is still thinking, only
 *   the player's move. When there is none (the player is black and undoes the first turn), back
 *   to the start, and the computer moves again (DESIGN 10.3).
 * - `request`: no local undo.
 */
export function undoTarget(g: Game, rule: UndoRule, color: Color): number {
  if (g.cursor === 0 || rule === 'request') return g.cursor;
  if (rule === 'ply') return g.cursor - 1;
  for (let c = g.cursor - 1; c >= 0; c--) if (turnAt(g, c) === color) return c;
  return 0;
}

/**
 * Cursor that redo goes forward to along the redo tail, or `g.cursor` when there is none.
 * `turn` replays both plies of a turn: forward to the next position where the player is to move,
 * or to the end of the tail.
 */
export function redoTarget(g: Game, rule: UndoRule, color: Color): number {
  const max = g.plies.length;
  if (g.cursor >= max || rule === 'request') return g.cursor;
  if (rule === 'ply') return g.cursor + 1;
  for (let c = g.cursor + 1; c <= max; c++) if (c === max || turnAt(g, c) === color) return c;
  return max;
}

/* ---------------------------------------------------------------------------------------------- */
/* Sessions                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/** The game open on the stage, with everything needed to save it (DESIGN 12.1). */
export interface GameSession {
  /** `SavedGame.id`: the code for solo games, `${code}.${n}` for room games. */
  readonly id: string;
  readonly code: string;
  readonly mode: Mode;
  /** Computer level 1–12; computer games only. */
  readonly level?: number;
  /** This device's side; `w` in pass-and-play. */
  readonly color: Color;
  /** Time control, e.g. `5+0`, or null. */
  readonly tc: TcString | null;
  /** The live game. Its redo tail beyond `cursor` lives only in this session (DESIGN 12.1). */
  readonly game: Game;
  /** A hint or an undo was used (DESIGN 7.3). */
  readonly assisted: boolean;
  readonly createdAt: number;
  /** As it will be saved; moves to `now` on every change, or after 15 s (DESIGN 12.1). */
  readonly lastPlayedAt: number;
  /** True once this session has changed the game or stayed 15 s (or created it). */
  readonly touched: boolean;
  /** `now()` when the session was opened; the 15-second rule counts from here. */
  readonly openedAt: number;
  /** Review cursor (read-only board), or null while playing live. */
  readonly review: number | null;
  readonly room?: { n: number; epoch: number };
}

/** Settings of a new game. */
export interface NewGameSpec {
  code: string;
  mode: Mode;
  level?: number;
  color: Color;
  tc: TcString | null;
  /** Start from this game (its plies up to its cursor) instead of the standard start. */
  game?: Game;
  assisted?: boolean;
}

/** A brand-new game: saved at once, "last played" now (Zudoku: a new game counts as a change). */
export function createSession(spec: NewGameSpec, now: number): GameSession {
  const game = spec.game ?? zhess.newGame();
  return {
    id: spec.code,
    code: spec.code,
    mode: spec.mode,
    ...(spec.mode === 'computer' ? { level: clampLevel(spec.level) ?? DEFAULT_LEVEL } : {}),
    color: spec.mode === 'local' ? 'w' : spec.color,
    tc: spec.tc,
    game,
    assisted: spec.assisted ?? false,
    createdAt: now,
    lastPlayedAt: now,
    touched: true,
    openedAt: now,
    review: game.end ? game.cursor : null,
  };
}

/** Rebuilds a stored game. Unreadable tails are cut (lenient), never thrown. */
export function gameFromSaved(saved: SavedGame): Game {
  const end: GameEnd | undefined = saved.result && saved.by ? { result: saved.result, by: saved.by } : undefined;
  try {
    return zhess.fromRecord(saved.moves, saved.ms, end, { lenient: true });
  } catch {
    return zhess.newGame();
  }
}

/** True when a stored game has a result. */
export function isFinished(saved: SavedGame): boolean {
  return !!saved.result;
}

/**
 * Opens a stored game: unfinished games resume (redo empty, "last played" untouched until a change
 * or 15 s), finished games open in review at their last position.
 */
export function sessionFromSaved(saved: SavedGame, now: number): GameSession {
  const game = gameFromSaved(saved);
  return {
    id: saved.id,
    code: saved.code,
    mode: saved.mode,
    ...(saved.mode === 'computer' ? { level: clampLevel(saved.level) ?? DEFAULT_LEVEL } : {}),
    color: saved.mode === 'local' ? 'w' : saved.color,
    tc: saved.tc ?? null,
    game,
    assisted: !!saved.assisted,
    createdAt: saved.createdAt,
    lastPlayedAt: saved.lastPlayedAt,
    touched: false,
    openedAt: now,
    review: game.end ? game.cursor : null,
    ...(saved.room ? { room: saved.room } : {}),
  };
}

/** The stored form of a session. Only the plies up to the cursor are kept (redo is session-only). */
export function toSavedGame(s: GameSession): SavedGame {
  const plies = s.game.plies.slice(0, s.game.cursor);
  const out: SavedGame = {
    id: s.id,
    code: s.code,
    mode: s.mode,
    color: s.color,
    tc: s.tc,
    moves: zhess.encodeMoves(plies),
    ms: plies.map((p) => p.ms),
    assisted: s.assisted,
    createdAt: s.createdAt,
    lastPlayedAt: s.lastPlayedAt,
  };
  if (s.mode === 'computer') out.level = s.level ?? DEFAULT_LEVEL;
  if (s.game.end) {
    out.result = s.game.end.result;
    out.by = s.game.end.by;
  }
  if (s.room) out.room = s.room;
  return out;
}

/** A changed session: new game value, "last played" now. */
function changed(s: GameSession, game: Game, now: number, extra: Partial<GameSession> = {}): GameSession {
  return { ...s, ...extra, game, lastPlayedAt: now, touched: true };
}

/** Whether moves can be played on the board right now (live, not over, not a room). */
export function canPlay(s: GameSession | null): s is GameSession {
  return !!s && s.review === null && !s.game.end && s.mode !== 'room';
}

/**
 * Whether the solo game is running: not over, not a room. Unlike `canPlay` this ignores review: a
 * move-list jump in a live game does not stop its clock or the computer (DESIGN 11: solo clocks
 * pause only when the tab is hidden or on Back).
 */
export function isRunning(s: GameSession | null): s is GameSession {
  return !!s && !s.game.end && s.mode !== 'room';
}

/** The computer is to move in a running game against it (it moves on while the player reviews). */
function computerToMove(s: GameSession): boolean {
  return isRunning(s) && s.mode === 'computer' && s.game.turn !== s.color;
}

/**
 * Plays `uci` with `ms` used. Null if the move is illegal or the board is not playable. The
 * computer's move also lands while the player looks back through the moves (review stays put).
 */
export function applyMove(s: GameSession, uci: string, ms: number, now: number): GameSession | null {
  if (!canPlay(s) && !computerToMove(s)) return null;
  try {
    return changed(s, zhess.play(s.game, uci, ms), now);
  } catch {
    return null;
  }
}

/** Undo per the mode's rule. Marks the game `assisted` (DESIGN 7.3). Null if nothing to undo. */
export function applyUndo(s: GameSession, now: number): GameSession | null {
  if (s.review !== null || s.mode === 'room') return null;
  const target = undoTarget(s.game, undoRuleFor(s.mode), s.color);
  if (target >= s.game.cursor) return null;
  return changed(s, zhess.undo(s.game, s.game.cursor - target), now, { assisted: true });
}

/** Redo per the mode's rule. Null if there is no redo tail. */
export function applyRedo(s: GameSession, now: number): GameSession | null {
  if (s.review !== null || s.mode === 'room' || s.game.end) return null;
  const target = redoTarget(s.game, undoRuleFor(s.mode), s.color);
  if (target <= s.game.cursor) return null;
  return changed(s, zhess.redo(s.game, target - s.game.cursor), now);
}

/**
 * Resignation. Against the computer the player resigns; in pass-and-play the side to move does.
 * Null if the game is over, in review, or a room game (the room controller resigns there).
 */
export function applyResign(s: GameSession, now: number): GameSession | null {
  if (!canPlay(s)) return null;
  const loser: Color = s.mode === 'local' ? s.game.turn : s.color;
  return changed(s, zhess.end(s.game, loser === 'w' ? '0-1' : '1-0', 'resign'), now);
}

/** Ends the game with any result (agreed draw, a time-out decided elsewhere). */
export function applyEnd(s: GameSession, end: GameEnd, now: number): GameSession | null {
  if (!canPlay(s)) return null;
  return changed(s, zhess.end(s.game, end.result, end.by), now);
}

/**
 * `flagged` ran out of time: a loss, or a draw when the other side cannot mate (DESIGN 8.2). The
 * clock runs on in review, so a flag can fall there too.
 */
export function applyTimeout(s: GameSession, flagged: Color, now: number): GameSession | null {
  if (!isRunning(s)) return null;
  return changed(s, zhess.timeout(s.game, flagged), now);
}

/** Takes back a manual ending (the 5-second resign undo toast). Null if there is none. */
export function applyReopen(s: GameSession, now: number): GameSession | null {
  if (s.mode === 'room' || !s.game.end) return null;
  const game = zhess.reopen(s.game);
  if (game === s.game) return null;
  return changed(s, game, now, { review: null });
}

/** The 15-second rule: the session now counts as played. */
export function applyTouch(s: GameSession, now: number): GameSession {
  if (s.touched) return s;
  return { ...s, lastPlayedAt: now, touched: true };
}

/** Marks the game as assisted (hint used). */
export function applyAssisted(s: GameSession): GameSession {
  return s.assisted ? s : { ...s, assisted: true };
}

/* ---------------------------------------------------------------------------------------------- */
/* Review (DESIGN 12.3)                                                                             */
/* ---------------------------------------------------------------------------------------------- */

/** Last cursor review can reach: the live cursor (the end of a finished game). */
export function reviewMax(s: GameSession): number {
  return s.game.cursor;
}

/**
 * Moves the review cursor. Clamped to `0..reviewMax`. On an unfinished game, reaching the live
 * position leaves review; a finished game always stays in review.
 */
export function applyGoto(s: GameSession, cursor: number): GameSession {
  const max = reviewMax(s);
  const c = Math.max(0, Math.min(max, Math.floor(cursor)));
  const review = c === max && !s.game.end ? null : c;
  return review === s.review ? s : { ...s, review };
}

/** The game value the board shows: the review position, or the live game. */
export function viewOf(s: GameSession): Game {
  return s.review === null ? s.game : zhess.goto(s.game, s.review);
}

/**
 * "Continue from here" (DESIGN 12.3): a new game from the shown position with a new code. Its
 * moves are the shown game's plies up to that position (so history and thumbnails work without a
 * start FEN), with times zeroed because clock times are not carried. Null if the shown position
 * is already over.
 */
export function continueSpec(
  view: Game,
  solo: Opponent,
  code: string,
  tc: TcString | null,
): NewGameSpec | null {
  const plies: Ply[] = view.plies.slice(0, view.cursor).map((p) => ({ m: p.m, ms: 0 }));
  let game: Game;
  try {
    game = zhess.replay(plies, view.start);
  } catch {
    return null;
  }
  if (game.end) return null;
  const mode: Mode = solo.mode === 'computer' ? 'computer' : 'local';
  return {
    code,
    mode,
    level: solo.mode === 'computer' ? solo.level : undefined,
    // Against the computer the player takes over the side to move.
    color: mode === 'local' ? 'w' : game.turn,
    tc,
    game,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Start pill (DESIGN 4.1)                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export type StartLabel = 'start' | 'resume' | 'review';

export interface StartPill {
  /** `start` (new code or room), `resume` (unfinished local game), `review` (finished local game). */
  readonly label: StartLabel;
  /** The stored game the code refers to; its settings are what the dimmed selectors show. */
  readonly saved: SavedGame | null;
}

/** The solo game stored under `code` (solo ids are the code). */
export function findSolo(games: readonly SavedGame[], code: string): SavedGame | null {
  return games.find((g) => g.id === code && g.mode !== 'room') ?? null;
}

/** Label of the Start pill for a code and opponent. Rooms always say `START` (create or join). */
export function startPillFor(code: string, opponent: Opponent, games: readonly SavedGame[]): StartPill {
  if (opponent.mode === 'room') return { label: 'start', saved: null };
  const saved = findSolo(games, code);
  if (!saved) return { label: 'start', saved: null };
  return { label: isFinished(saved) ? 'review' : 'resume', saved };
}

/* ---------------------------------------------------------------------------------------------- */
/* History grouping (Zudoku GameHistory, DESIGN 12.2)                                               */
/* ---------------------------------------------------------------------------------------------- */

/** Time groups of the full history list, as in Zudoku. Labels are the UI's (1E) to translate. */
export type TimeGroupKey = 'today' | 'week' | 'month' | 'year' | 'older';

export interface TimeGroup {
  readonly key: TimeGroupKey;
  readonly games: SavedGame[];
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Groups games by `lastPlayedAt`, newest first, empty groups dropped: today (since local
 * midnight), this week (7 days before that), this month (30), this year (365), older.
 */
export function groupByTime(games: readonly SavedGame[], now: number): TimeGroup[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const bounds: [TimeGroupKey, number][] = [
    ['today', today],
    ['week', today - 7 * DAY],
    ['month', today - 30 * DAY],
    ['year', today - 365 * DAY],
    ['older', -Infinity],
  ];
  const groups: TimeGroup[] = bounds.map(([key]) => ({ key, games: [] }));
  const sorted = [...games].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  for (const g of sorted) {
    const i = bounds.findIndex(([, from]) => g.lastPlayedAt >= from);
    groups[i].games.push(g);
  }
  return groups.filter((g) => g.games.length > 0);
}

/* ---------------------------------------------------------------------------------------------- */
/* Change notification between hooks                                                               */
/* ---------------------------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

/** Subscribe to "stored games changed" (saves by `useGameState`, deletes by `useSavedGames`). */
export function onSavedGamesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tell every subscriber that the stored games changed. */
export function notifySavedGames(): void {
  for (const cb of [...listeners]) cb();
}
