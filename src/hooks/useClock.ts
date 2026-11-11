/**
 * The running chess clock (DESIGN 11, 9.8) and the premove queue (DESIGN 6.3) as React hooks.
 *
 * `useClock` times the running turn with monotonic stamps (`performance.now()`), never by counting
 * ticks, and derives both clocks from the move log (`lib/clock.ts`). A ~100 ms display tick runs
 * only while the turn is timed. In solo modes the turn pauses while the tab is hidden and while
 * the caller says `paused` (Back / leave), and resumes on return. Undo / redo restore the clocks
 * by themselves: the log is the truth and a new position starts a new turn.
 *
 * The page passes `clock.elapsed()` as the `ms` of each move (`useGameState.move(uci, ms)`), and
 * `onFlag` ends the game (`useGameState.timeout(color)`); it fires once per turn.
 *
 * `usePremove` wires the pure premove machine of `lib/premove.ts` to the board's `premove` /
 * `onPremove` props and plays the queued move when the opponent has moved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clockView,
  remaining,
  tickInterval,
  timerElapsed,
  timerReset,
  timerSet,
  toTimeControl,
  type ClockView,
  type TurnTimer,
} from '@/lib/clock';
import {
  NO_PREMOVE,
  cancel as cancelPremove,
  premoveAllowed,
  queue,
  settle,
  type PremoveState,
  type QueuedMove,
} from '@/lib/premove';
import type { Color, Game, Mode, Now, TcString, TimeControl, Uci } from '@/lib/types';
import { formatClock, formatElapsed } from '@/lib/timeUtils';

/* ---------------------------------------------------------------------------------------------- */
/* useClock                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/** A running turn measured elsewhere (room controller, DESIGN 9.8): `RoomSnapshot.clock`. */
export interface ExternalTurn {
  /** `now()` stamp at which the side to move's turn (re)started; null while paused. */
  readonly turnStart: number | null;
  /** What that side had already used in this turn before the last pause. */
  readonly turnUsed: number;
}

export interface UseClockOptions {
  /**
   * The game is on screen and playable: phase `playing`, not review, not the start screen.
   * Default true. False pauses the turn (it resumes, with the time already spent, on return).
   */
  readonly active?: boolean;
  /** Explicit pause, e.g. while the player has left the game with Back. Default false. */
  readonly paused?: boolean;
  /** Pause while the tab is hidden (solo modes, DESIGN 11). Default true; pass false in rooms. */
  readonly pauseWhenHidden?: boolean;
  /** Session identity (game id or room code + game number). A change starts a fresh turn. */
  readonly key?: string | null;
  /** Monotonic clock in ms. Default `performance.now()`. Must match `external`'s stamps. */
  readonly now?: Now;
  /** The side to move ran out of time. Fires once per turn, only while the turn is timed. */
  readonly onFlag?: (color: Color) => void;
  /**
   * Room (DESIGN 9.8): this device's color. The opponent's flag is only reported once their clock
   * has read zero for `opponentGraceMs` (default 2000); this device's own flag fires at zero.
   * Leave unset in solo modes (both flags fire at zero).
   */
  readonly ownColor?: Color;
  readonly opponentGraceMs?: number;
  /**
   * Room: the running turn as the room controller keeps it. When given, the hook does not time
   * the turn itself (no visibility or pause handling) and only displays and flags.
   */
  readonly external?: ExternalTurn | null;
  /** Ms already spent on the current turn when it first appears (e.g. restored after a reload). */
  readonly initialTurnMs?: number;
  /** Display tick override in ms. Default 100 with a clock, 250 without. */
  readonly tickMs?: number;
}

export interface ClockState extends ClockView {
  /**
   * Ms the side to move has spent on the running turn, read now. Pass it as the `ms` of the move
   * being made (player or computer). Works with the clock off too (time used is always recorded).
   */
  elapsed(): number;
  /** The running turn is being timed now (live, not paused, tab visible in solo modes). */
  readonly ticking: boolean;
  /** `elapsed()` as of this render. */
  readonly turnMs: number;
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Identity of a turn: a new position (move, undo, redo, takeback) or another session starts a new one. */
function turnKeyOf(game: Game | null, key: string | null | undefined): string {
  return game ? `${key ?? ''}|${game.cursor}|${game.fen}` : `${key ?? ''}|-`;
}

/** Faces for "no game": the base time (timed) or nothing used. */
function emptyView(tc: TimeControl): ClockView {
  const face = tc
    ? { text: formatClock(tc.baseMs), running: false, low: false, flagged: false, untimed: false, ms: tc.baseMs }
    : { text: formatElapsed(0), running: false, low: false, flagged: false, untimed: true, ms: 0 };
  return { w: face, b: face, timed: !!tc, counting: false, flagged: null };
}

/**
 * Chess clock for `game` under `tc` (object, `5+0` string or null = clock off).
 * Returns both faces (ready for `PlayerStrip`'s `clock` prop), the flag, and `elapsed()`.
 */
export function useClock(game: Game | null, tcIn: TimeControl | TcString | null, opts: UseClockOptions = {}): ClockState {
  const {
    active = true,
    paused = false,
    pauseWhenHidden = true,
    key = null,
    onFlag,
    ownColor,
    opponentGraceMs = 2000,
    external = null,
    initialTurnMs = 0,
  } = opts;
  const tcKey = typeof tcIn === 'string' ? tcIn : tcIn ? `${tcIn.baseMs}+${tcIn.incMs}` : null;
  // Normalized once per distinct value so effects do not re-run on a new object each render.
  const tcRef = useRef<{ key: string | null; tc: TimeControl }>({ key: null, tc: null });
  if (tcRef.current.key !== tcKey) tcRef.current = { key: tcKey, tc: toTimeControl(tcIn) };
  const tc = tcRef.current.tc;

  const nowRef = useRef<Now>(opts.now ?? defaultNow);
  nowRef.current = opts.now ?? defaultNow;
  const onFlagRef = useRef(onFlag);
  onFlagRef.current = onFlag;

  const [hidden, setHidden] = useState(documentHidden);
  const [, setTick] = useState(0);

  const live = active && !!game && !game.end;
  const running = live && !paused && !(pauseWhenHidden && hidden);

  /* ---- own turn timer (solo modes) ---- */
  const turnKey = turnKeyOf(game, key);
  const timer = useRef<{ key: string; session: string | null; hadGame: boolean; t: TurnTimer } | null>(null);
  const at = nowRef.current();
  const prev = timer.current;
  if (!prev || prev.key !== turnKey) {
    // The first turn seen of a session may carry time spent before (a reload).
    const firstOfSession = !prev || prev.session !== key || !prev.hadGame;
    timer.current = {
      key: turnKey,
      session: key,
      hadGame: !!game,
      t: timerReset(running, at, firstOfSession && game ? initialTurnMs : 0),
    };
  } else {
    timer.current = { ...prev, t: timerSet(prev.t, running, at) };
  }

  const externalRef = useRef(external);
  externalRef.current = external;

  const elapsed = useCallback((): number => {
    const ext = externalRef.current;
    const t = nowRef.current();
    if (ext) return Math.max(0, ext.turnUsed + (ext.turnStart !== null ? Math.max(0, t - ext.turnStart) : 0));
    return timer.current ? timerElapsed(timer.current.t, t) : 0;
  }, []);

  const ticking = external ? live && external.turnStart !== null : running;

  /* ---- tab visibility: bank the turn at the exact moment the tab hides ---- */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      const isHidden = documentHidden();
      const cur = timer.current;
      if (cur && pauseWhenHidden) {
        const t = nowRef.current();
        // Hidden: pause now. Visible: resume now unless something else holds the clock.
        if (isHidden) timer.current = { ...cur, t: timerSet(cur.t, false, t) };
        else if (live && !paused) timer.current = { ...cur, t: timerSet(cur.t, true, t) };
      }
      setHidden(isHidden);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pauseWhenHidden, live, paused]);

  /* ---- display tick, only while timed ---- */
  const every = opts.tickMs ?? tickInterval(tc);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), every);
    return () => clearInterval(id);
  }, [ticking, every]);

  /* ---- view ---- */
  const turnMs = elapsed();
  const view = game ? clockView(game, tc, turnMs, { live: ticking }) : emptyView(tc);

  /* ---- flag: once per turn ---- */
  let flagNow: Color | null = null;
  if (game && ticking && view.counting) {
    const left = remaining(game, tc, turnMs)[game.turn];
    const grace = ownColor && game.turn !== ownColor ? Math.max(0, opponentGraceMs) : 0;
    if (left <= -grace) flagNow = game.turn;
  }
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!flagNow || fired.current === turnKey) return;
    fired.current = turnKey;
    onFlagRef.current?.(flagNow);
  }, [flagNow, turnKey]);

  return { ...view, ticking, turnMs, elapsed };
}

/* ---------------------------------------------------------------------------------------------- */
/* usePremove                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

export interface UsePremoveOptions {
  /** The color this device plays. */
  readonly player: Color;
  readonly mode: Mode;
  readonly tc: TimeControl | TcString | null;
  /** False in review, on the start screen, while a room is locked. Default true. */
  readonly live?: boolean;
  /** Session identity; a change drops the premove. */
  readonly key?: string | null;
  /**
   * Play the premove now: canonical UCI, legal for `player`. Call `useGameState.move` (or the
   * room's) directly with `clock.elapsed()`; premoves bypass the blunder guard (DESIGN 6.3).
   */
  readonly onFire: (uci: Uci) => void;
}

export interface PremoveControls {
  /** The queued move for the board's `premove` prop. */
  readonly premove: QueuedMove | null;
  /** For the board's `onPremove` prop; undefined when premoves are not allowed (turns them off). */
  readonly onPremove: ((pm: QueuedMove | null) => void) | undefined;
  /** Drop the queued move (e.g. on Escape or when leaving the game). */
  cancel(): void;
  /** Premoves are possible in this game (DESIGN 6.3). */
  readonly allowed: boolean;
}

/** Premove queue for `game`: hands the board its props and fires the move when the opponent has moved. */
export function usePremove(game: Game | null, opts: UsePremoveOptions): PremoveControls {
  const { player, mode, tc, live = true, key = null } = opts;
  const allowed = premoveAllowed({ mode, tc, live }) && !!game && !game.end;
  const [state, setState] = useState<PremoveState>(NO_PREMOVE);
  const stateRef = useRef(state);
  const onFireRef = useRef(opts.onFire);
  onFireRef.current = opts.onFire;
  const gameRef = useRef(game);
  gameRef.current = game;

  const set = useCallback((s: PremoveState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  useEffect(() => {
    const cur = stateRef.current;
    if (!cur.move) return;
    if (!allowed || !game) {
      set(NO_PREMOVE);
      return;
    }
    const r = settle(cur, game, player, key);
    if (r.state !== cur) set(r.state);
    if (r.fire) onFireRef.current(r.fire);
  }, [game, player, key, allowed, set]);

  const onPremove = useCallback(
    (pm: QueuedMove | null) => {
      const g = gameRef.current;
      if (!pm || !g) {
        set(cancelPremove());
        return;
      }
      const next = queue(stateRef.current, g, player, pm, key);
      if (next !== stateRef.current) set(next);
    },
    [player, key, set],
  );

  const cancel = useCallback(() => set(cancelPremove()), [set]);

  return { premove: allowed ? state.move : null, onPremove: allowed ? onPremove : undefined, cancel, allowed };
}
