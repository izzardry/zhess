/**
 * Start-screen values and their cycling rules (DESIGN 4.1). Pure, no React.
 *
 * - Opponent stepper: ROOM · TWO PLAYERS · COMPUTER 1 … COMPUTER 12 (ends do not wrap).
 * - Color pill: random → white → black → random.
 * - Clock pill: off · 1+0 · 3+2 · 5+0 · 10+0 · 15+10 · 30+0 → off.
 * - Start pill label: START / RESUME / REVIEW from the code's saved game.
 */
import type { ColorChoice, Opponent, SavedGame, TimeControl } from '@/lib/types';

/* ---------------------------------------------------------------------------------------------- */
/* Opponent                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** Lowest and highest computer level (DESIGN 10.2). */
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 12;
/** First-run default: COMPUTER 5 MEDIUM (DESIGN 4.1). */
export const DEFAULT_LEVEL = 5;

export const DEFAULT_OPPONENT: Opponent = Object.freeze({ mode: 'computer', level: DEFAULT_LEVEL });

/** Every stepper value in order. */
export const OPPONENTS: readonly Opponent[] = Object.freeze([
  Object.freeze({ mode: 'room' }) as Opponent,
  Object.freeze({ mode: 'local' }) as Opponent,
  ...Array.from({ length: MAX_LEVEL }, (_, i) => Object.freeze({ mode: 'computer', level: i + 1 }) as Opponent),
]);

/** True for a well-formed opponent value (guards what comes out of storage). */
export function isOpponent(v: unknown): v is Opponent {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.mode === 'room' || o.mode === 'local') return true;
  return (
    o.mode === 'computer' &&
    typeof o.level === 'number' &&
    Number.isInteger(o.level) &&
    o.level >= MIN_LEVEL &&
    o.level <= MAX_LEVEL
  );
}

/** Position of `o` in `OPPONENTS` (0 = ROOM). Out-of-range levels are clamped. */
export function opponentIndex(o: Opponent): number {
  if (o.mode === 'room') return 0;
  if (o.mode === 'local') return 1;
  const level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(o.level)));
  return 1 + level;
}

/** The value `delta` steps away from `o`, clamped to the ends (no wrap, Ztyle stepper). */
export function stepOpponent(o: Opponent, delta: number): Opponent {
  const i = Math.min(OPPONENTS.length - 1, Math.max(0, opponentIndex(o) + delta));
  return OPPONENTS[i];
}

export function canStepOpponent(o: Opponent, delta: number): boolean {
  const i = opponentIndex(o) + delta;
  return i >= 0 && i < OPPONENTS.length;
}

export function sameOpponent(a: Opponent, b: Opponent): boolean {
  return opponentIndex(a) === opponentIndex(b);
}

/* ---------------------------------------------------------------------------------------------- */
/* Color                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export const COLOR_CHOICES: readonly ColorChoice[] = Object.freeze(['random', 'w', 'b'] as const);
export const DEFAULT_COLOR: ColorChoice = 'random';

export function isColorChoice(v: unknown): v is ColorChoice {
  return v === 'random' || v === 'w' || v === 'b';
}

/** random → white → black → random. */
export function nextColor(c: ColorChoice): ColorChoice {
  const i = COLOR_CHOICES.indexOf(c);
  return COLOR_CHOICES[(i + 1) % COLOR_CHOICES.length];
}

/* ---------------------------------------------------------------------------------------------- */
/* Clock                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const tc = (min: number, inc: number): TimeControl => Object.freeze({ baseMs: min * 60_000, incMs: inc * 1000 });

/** The pill's presets in cycle order; `null` = off (DESIGN 4.1, 11). */
export const CLOCK_PRESETS: readonly TimeControl[] = Object.freeze([
  null,
  tc(1, 0),
  tc(3, 2),
  tc(5, 0),
  tc(10, 0),
  tc(15, 10),
  tc(30, 0),
]);

export function sameClock(a: TimeControl, b: TimeControl): boolean {
  if (a === null || b === null) return a === b;
  return a.baseMs === b.baseMs && a.incMs === b.incMs;
}

/** True when `t` is one of the cycling presets (false for a custom dial value). */
export function isPresetClock(t: TimeControl): boolean {
  return CLOCK_PRESETS.some((p) => sameClock(p, t));
}

/**
 * The next preset after `t`. A custom value (from the M2 dial) moves to the first preset that is
 * longer (by base, then increment), or back to off when none is.
 */
export function nextClock(t: TimeControl): TimeControl {
  const i = CLOCK_PRESETS.findIndex((p) => sameClock(p, t));
  if (i >= 0) return CLOCK_PRESETS[(i + 1) % CLOCK_PRESETS.length];
  if (t === null) return CLOCK_PRESETS[1];
  const later = CLOCK_PRESETS.find(
    (p) => p !== null && (p.baseMs > t.baseMs || (p.baseMs === t.baseMs && p.incMs > t.incMs)),
  );
  return later ?? null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Start pill                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** What the one primary action does (DESIGN 4.1 table). */
export type StartLabel = 'start' | 'resume' | 'review';

/**
 * The local solo game a code refers to, if any: `SavedGame.id === code` and not a room game.
 * Room games are stored as `${code}.${n}` and never match (a room code always starts or joins).
 */
export function findGameForCode(games: readonly SavedGame[], code: string): SavedGame | undefined {
  if (!code) return undefined;
  return games.find((g) => g.id === code && g.mode !== 'room');
}

/**
 * Label of the Start pill. Opponent = Room → START (create or join, DESIGN 9.2); a code with an
 * unfinished local game → RESUME; with a finished one → REVIEW; a new code → START.
 */
export function startLabel(opponent: Opponent, saved: SavedGame | undefined): StartLabel {
  if (opponent.mode === 'room') return 'start';
  if (!saved) return 'start';
  return saved.result ? 'review' : 'resume';
}

/** The opponent a saved game was played against (for the dimmed selectors on RESUME / REVIEW). */
export function opponentOfGame(g: SavedGame): Opponent {
  if (g.mode === 'room') return OPPONENTS[0];
  if (g.mode === 'local') return OPPONENTS[1];
  const level = typeof g.level === 'number' ? g.level : DEFAULT_LEVEL;
  return OPPONENTS[opponentIndex({ mode: 'computer', level })];
}
