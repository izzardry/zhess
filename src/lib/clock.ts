/**
 * Chess clock math (DESIGN 11, 9.8). Pure: no React, no DOM, time is passed in.
 *
 * The clock is never accumulated from ticks. Remaining time is derived from the move log
 * (`zhess.clocks`: Fischer increment, each side's first move untimed) minus what the side to move
 * has spent on the running turn. The running turn is measured by a `TurnTimer`: the ms already
 * used plus the monotonic stamp (`performance.now()` in the app) at which it last (re)started.
 * A throttled background tab therefore cannot drift, and undo / redo restore the clocks by
 * themselves, because they move the cursor and the log is the truth.
 */
import { formatClock, formatElapsed, isLowTime } from './timeUtils';
import type { Color, Game, TcString, TimeControl } from './types';
import { clockRunning, clocks, parseTc } from './zhess';

/* ---------------------------------------------------------------------------------------------- */
/* Time controls                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/** A time control in either form (`{ baseMs, incMs }`, `5+0`, null / `off`) → `TimeControl`. */
export function toTimeControl(tc: TimeControl | TcString | null | undefined): TimeControl {
  if (tc === null || tc === undefined) return null;
  if (typeof tc === 'string') return parseTc(tc);
  return tc.baseMs > 0 ? tc : null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Turn timer                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Time spent on the running turn: `used` ms banked before the last pause plus `now - since`
 * while running. `since === null` = paused. Immutable; every operation returns a new value.
 */
export interface TurnTimer {
  readonly used: number;
  readonly since: number | null;
}

/** A fresh turn: nothing used; running from `at` when `running`, else paused. */
export function timerReset(running: boolean, at: number, used = 0): TurnTimer {
  return { used: Math.max(0, used), since: running ? at : null };
}

/** Starts or resumes the timer at `at`. A running timer is returned unchanged. */
export function timerResume(t: TurnTimer, at: number): TurnTimer {
  return t.since === null ? { used: t.used, since: at } : t;
}

/** Pauses the timer at `at`, banking the time since it last started. A paused timer is unchanged. */
export function timerPause(t: TurnTimer, at: number): TurnTimer {
  return t.since === null ? t : { used: t.used + Math.max(0, at - t.since), since: null };
}

/** Pauses or resumes to match `running`. */
export function timerSet(t: TurnTimer, running: boolean, at: number): TurnTimer {
  return running ? timerResume(t, at) : timerPause(t, at);
}

/** Ms spent on the running turn at `at`. Never negative (a clock that went backwards counts 0). */
export function timerElapsed(t: TurnTimer, at: number): number {
  return Math.max(0, t.used + (t.since !== null ? Math.max(0, at - t.since) : 0));
}

/* ---------------------------------------------------------------------------------------------- */
/* Remaining time and flag                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/**
 * True when the side to move's clock counts down now: a clock is set, the game is not over and
 * that side has already moved once (its first move is untimed, DESIGN 9.8 / BUILD-LOG 0b).
 */
export function isCounting(g: Game, tc: TimeControl): boolean {
  return !!tc && !g.end && clockRunning(g);
}

/**
 * Remaining ms per side (timed) or ms used per side (clock off), at the cursor, with `turnMs`
 * spent by the side to move on the running turn. Timed values are not clamped: a side past its
 * flag reads negative, which `flagged` and the 2-second room grace need (DESIGN 9.8).
 * After the game ended `turnMs` is ignored.
 */
export function remaining(g: Game, tc: TimeControl, turnMs: number): Record<Color, number> {
  const base = clocks(g, tc);
  const spent = Math.max(0, turnMs);
  if (g.end || spent === 0) return base;
  if (!tc) return { ...base, [g.turn]: base[g.turn] + spent };
  if (!clockRunning(g)) return base;
  return { ...base, [g.turn]: base[g.turn] - spent };
}

/** The side whose flag has fallen at this moment (timed, live game, ≤ 0 left), else null. */
export function flagged(g: Game, tc: TimeControl, turnMs: number): Color | null {
  if (!isCounting(g, tc)) return null;
  return remaining(g, tc, turnMs)[g.turn] <= 0 ? g.turn : null;
}

/**
 * Ms of running turn left before the side to move flags (≥ 0), or null when no clock counts.
 * Lets a caller schedule one exact timeout instead of polling.
 */
export function msUntilFlag(g: Game, tc: TimeControl, turnMs: number): number | null {
  if (!isCounting(g, tc)) return null;
  return Math.max(0, remaining(g, tc, turnMs)[g.turn]);
}

/* ---------------------------------------------------------------------------------------------- */
/* Display                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

/**
 * What one clock shows (DESIGN 11, 14.1). Same shape as `StripClock` of the player strip plus `ms`,
 * so it can be passed to `PlayerStrip` as is.
 */
export interface ClockFace {
  /** `m:ss`; below 10 s `s.t`; `0.0` at zero. Clock off: time used as `m:ss` / `h:mm:ss`. */
  readonly text: string;
  /** This clock counts down right now (drawn on a light chip). False with the clock off. */
  readonly running: boolean;
  /** Below 10 s: bold and tenths (DESIGN 11). */
  readonly low: boolean;
  /** At zero or lost on time: `0.0` in `destructive`. */
  readonly flagged: boolean;
  /** Clock off: the face shows time used, dimmed. */
  readonly untimed: boolean;
  /** Remaining ms clamped at 0 (timed), or ms used (clock off). */
  readonly ms: number;
}

/** Both clocks plus what the page needs to act on them. */
export interface ClockView {
  readonly w: ClockFace;
  readonly b: ClockFace;
  /** A clock is set. */
  readonly timed: boolean;
  /** The side to move's clock counts down now. */
  readonly counting: boolean;
  /** The side out of time right now (live) or the side that lost on time (game over), else null. */
  readonly flagged: Color | null;
}

export interface ClockViewOptions {
  /**
   * The turn is being timed now (a live game on screen, not paused, not hidden). Only changes the
   * `running` chip: a paused clock still shows the time already spent on the turn.
   */
  readonly live?: boolean;
}

/**
 * Display state of both clocks for a game at its cursor (DESIGN 11): remaining time with a clock,
 * time used without one. A game lost on time shows `0.0` on the flagged side even though the
 * overrun of the last turn is not in the log.
 */
export function clockView(g: Game, tc: TimeControl, turnMs: number, opts: ClockViewOptions = {}): ClockView {
  const live = opts.live ?? true;
  const left = remaining(g, tc, turnMs);
  const timed = !!tc;
  const counting = isCounting(g, tc);
  const lostOnTime: Color | null = g.end?.by === 'time' ? g.turn : null;
  const liveFlag = counting && left[g.turn] <= 0 ? g.turn : null;
  const face = (c: Color): ClockFace => {
    if (!timed) {
      const ms = Math.max(0, left[c]);
      return { text: formatElapsed(ms), running: false, low: false, flagged: false, untimed: true, ms };
    }
    const out = lostOnTime === c || liveFlag === c;
    const ms = out ? 0 : Math.max(0, left[c]);
    return {
      text: formatClock(ms),
      running: live && counting && g.turn === c,
      low: isLowTime(ms),
      flagged: out,
      untimed: false,
      ms,
    };
  };
  return { w: face('w'), b: face('b'), timed, counting, flagged: lostOnTime ?? liveFlag };
}

/**
 * Display tick interval: tenths matter only below 10 s, but a 100 ms tick keeps the `m:ss`
 * seconds change on time too. With the clock off the face shows whole seconds.
 */
export function tickInterval(tc: TimeControl): number {
  return tc ? 100 : 250;
}

/* ---------------------------------------------------------------------------------------------- */
/* Custom time control (the clock dial)                                                            */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Minutes on the custom dial, clockwise from 12 o'clock. Nine items: the Ztyle radial dial holds
 * at most nine values (Ztyle 08), so 45 and 90 of the brief's example list were left out.
 */
export const DIAL_MINUTES: readonly number[] = Object.freeze([1, 2, 3, 5, 10, 15, 20, 30, 60]);

/** Increment seconds on the custom dial, clockwise from 12 o'clock. */
export const DIAL_INCREMENTS: readonly number[] = Object.freeze([0, 1, 2, 3, 5, 10, 15, 20, 30]);

/** `5`, `3` → `5+3`; the TcString of a custom pick. */
export function customTc(minutes: number, incrementSeconds: number): TcString {
  return `${minutes}+${incrementSeconds}`;
}

/** Index in `list` of the value closest to `v` (ties: the smaller), for the dial's start aim. */
export function nearestIndex(list: readonly number[], v: number): number {
  let best = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i;
  return best;
}

/**
 * Ztyle radial dial distances (Ztyle 08; the same values as the promotion dial in
 * `components/board/dial.ts`): centre < 25 px, dead ring to 40 px, aim 40–55 px, commit ≥ 55 px.
 */
export const DIAL_GEOMETRY = Object.freeze({
  radius: 60,
  popRadius: 105,
  center: 25,
  aim: 40,
  commit: 55,
  /** Radius + half an item: how far the dial reaches from its centre. */
  reach: 80,
});

export type DialZone = 'center' | 'none' | 'aim' | 'commit';

/** What a pointer offset from the dial's start point selects on an `n`-item dial (item 0 at 12 o'clock, clockwise). */
export function dialAim(dx: number, dy: number, n: number): { zone: DialZone; index: number | null } {
  const d = Math.hypot(dx, dy);
  if (d < DIAL_GEOMETRY.center) return { zone: 'center', index: null };
  if (d <= DIAL_GEOMETRY.aim || n <= 0) return { zone: 'none', index: null };
  let a = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / n;
  a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const index = Math.floor((a / (2 * Math.PI)) * n) % n;
  return { zone: d >= DIAL_GEOMETRY.commit ? 'commit' : 'aim', index };
}

/** Position of item `i` of `n` at radius `r` around the centre (12 o'clock first, clockwise). */
export function dialItemOffset(i: number, n: number, r: number): { x: number; y: number } {
  const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
  // Rounded to 1/100 px so 12 o'clock is exactly (0, -r).
  const round = (v: number) => Math.round(v * 100) / 100 || 0;
  return { x: round(Math.cos(angle) * r), y: round(Math.sin(angle) * r) };
}
