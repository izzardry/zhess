/**
 * The computer opponent's turn loop (DESIGN 10) and the engine preparation behind the Start pill
 * (DESIGN 10.1).
 *
 * `useComputer`: whenever the live computer game has the computer to move, ask the engine for a
 * move at the game's level, wait until at least `MIN_REPLY_MS` have passed since the turn began
 * (so moves never teleport), and hand the move to `onMove`. This covers the computer's first move
 * when the player is black, a resumed game where the computer is to move, and undoing the very
 * first turn as black (the computer moves again, DESIGN 10.3).
 *
 * Every turn has a generation number. Any change of position (move, undo, redo), session, level,
 * or leaving the game (enabled → false) starts a new generation: a result of an older one is
 * ignored, and its still-running search is stopped. In timed games the engine gets both clocks
 * (`engineClock`) and keeps to its own time (lib/levels.ts).
 *
 * `useEngineStart`: the Start pill's spinner with progress while the engine loads for a new
 * computer game, then go (or a calm failure).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineUnavailableError, isEngineAbort } from '@/lib/engine/driver';
import { MIN_REPLY_MS, legalUci, type EngineClock } from '@/lib/levels';
import type { Color, EngineApi, Game, Now, TcString, TimeControl, Uci } from '@/lib/types';
import { clocks, parseTc } from '@/lib/zhess';

/* ---------------------------------------------------------------------------------------------- */
/* Pure helpers                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/** Normalizes a time control given as text (`5+0`) or object; null = clock off. */
export function toTc(tc: TimeControl | TcString | null | undefined): TimeControl {
  if (!tc) return null;
  return typeof tc === 'string' ? parseTc(tc) : tc;
}

/**
 * Both remaining clocks at the cursor (excluding the running turn) and the increment, as
 * `EngineApi.bestMove` takes them; undefined when the clock is off or the game is over.
 */
export function engineClock(g: Game, tc: TimeControl | TcString | null | undefined): EngineClock | undefined {
  const t = toTc(tc);
  if (!t || g.end) return undefined;
  const left = clocks(g, t);
  return { wMs: Math.max(0, left.w), bMs: Math.max(0, left.b), incMs: t.incMs };
}

/** The move to play for an engine answer: the answer if legal at `fen`, else the first legal move (never null unless none exists). */
export function playableMove(fen: string, uci: Uci | null | undefined): Uci | null {
  const legal = legalUci(fen);
  if (uci) {
    const u = uci.toLowerCase();
    if (legal.includes(u)) return u;
    // A queen promotion answered without its letter.
    if (u.length === 4 && legal.includes(`${u}q`)) return `${u}q`;
  }
  return legal[0] ?? null;
}

function isUnavailable(e: unknown): boolean {
  return e instanceof EngineUnavailableError || (e instanceof Error && e.name === 'EngineUnavailableError');
}

/* ---------------------------------------------------------------------------------------------- */
/* useComputer                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** Searches cancelled by somebody else's `stop()` are retried this often per turn. */
const ABORT_RETRIES = 2;

export interface UseComputerOptions {
  /** The shared engine (`useZhessEngine()`). */
  engine: EngineApi;
  /** The live game (`session.game`), or null. */
  game: Game | null;
  /**
   * Computer mode, phase `playing` (not review, not the start screen), `flags.computer`. The hook
   * itself waits for the computer's turn and stops when the game is over.
   */
  enabled: boolean;
  /** The computer's color: the opposite of `session.color`. */
  computerColor: Color | null;
  /** Level 1–12 (`session.level`). */
  level: number;
  /** Time control of the game (`session.tc`), or null. */
  tc?: TimeControl | TcString | null;
  /** Plays the computer's move: `useGameState.move(uci, ms)`. Called at most once per turn. */
  onMove: (uci: Uci, ms: number) => void;
  /** The engine failed to load or crashed: show the calm toast (`engine.failed` / `engine.failedOffline` + `engine.retry`). */
  onFail?: (error: unknown) => void;
  /** Time the computer used on this turn, read when it moves (`useClock().elapsed`). Default: wall time since the turn began. */
  elapsed?: () => number;
  /** Session identity (`session.id`); a change starts a new turn. */
  sessionKey?: string | null;
  /** Default `Date.now`. */
  now?: Now;
  /** Default `MIN_REPLY_MS` (400). */
  minReplyMs?: number;
}

export interface ComputerState {
  /** The computer is searching or waiting out the minimum reply time. */
  readonly thinking: boolean;
  /** The last search failed because the engine is unavailable. */
  readonly failed: boolean;
  /** Try the turn again (the engine retries loading). The toast's `engine.retry` action. */
  retry(): void;
}

export function useComputer(opts: UseComputerOptions): ComputerState {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { game, enabled, computerColor, level, sessionKey = null } = opts;
  const due = enabled && !!game && !game.end && game.turn === computerColor;
  const turnKey = due && game ? `${sessionKey ?? ''}|${level}|${game.cursor}|${game.fen}` : null;

  const gen = useRef(0);
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!turnKey) {
      setThinking(false);
      return;
    }
    const counter = gen;
    const my = ++counter.current;
    const o = optsRef.current;
    const g = o.game as Game;
    const now = o.now ?? Date.now;
    const start = now();
    const minReply = Math.max(0, o.minReplyMs ?? MIN_REPLY_MS);
    const clock = engineClock(g, o.tc);
    let searching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setThinking(true);
    setFailed(false);

    const deliver = (uci: Uci) => {
      if (my !== gen.current) return;
      setThinking(false);
      const cur = optsRef.current;
      const ms = cur.elapsed ? cur.elapsed() : now() - start;
      cur.onMove(uci, Math.max(0, ms));
    };

    const search = (retries: number) => {
      searching = true;
      let p: Promise<Uci>;
      try {
        p = o.engine.bestMove(g.fen, o.level, clock);
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (answer) => {
          if (my !== gen.current) return;
          searching = false;
          const move = playableMove(g.fen, answer);
          if (!move) {
            setThinking(false);
            return;
          }
          const wait = Math.max(0, start + minReply - now());
          if (wait === 0) deliver(move);
          else timer = setTimeout(() => deliver(move), wait);
        },
        (err: unknown) => {
          if (my !== gen.current) return;
          searching = false;
          if (isEngineAbort(err) && retries > 0) {
            search(retries - 1);
            return;
          }
          setThinking(false);
          if (isUnavailable(err) || optsRef.current.engine.state === 'failed') {
            setFailed(true);
            optsRef.current.onFail?.(err);
          }
        },
      );
    };
    search(ABORT_RETRIES);

    return () => {
      counter.current++;
      clearTimeout(timer);
      // Free the engine for whatever comes next (undo, leave). Only our own search is running
      // during the computer's turn, so this does not cancel anyone else's.
      if (searching) o.engine.stop();
    };
  }, [turnKey, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  return { thinking, failed, retry };
}

/* ---------------------------------------------------------------------------------------------- */
/* useEngineStart: the Start pill while the engine loads                                            */
/* ---------------------------------------------------------------------------------------------- */

export interface EngineStart {
  /** Show the Start pill's spinner (`StartPill loading`). */
  readonly loading: boolean;
  /** 0..1 for the Start pill's `progress`. */
  readonly progress: number;
  /**
   * Load the engine before a computer game starts. Resolves true when it is ready (at once when it
   * already is), false when it failed (`onFail` was called) or another `prepare` superseded it.
   * Call `cancel()` when the user leaves the start screen meanwhile.
   */
  prepare(): Promise<boolean>;
  /** Forget a running `prepare` (it resolves false); the download itself goes on in the background. */
  cancel(): void;
}

export interface UseEngineStartOptions {
  /** Called with the load error; show `engine.failed` (online) or `engine.failedOffline` (offline). */
  onFail?: (error: unknown) => void;
}

/**
 * DESIGN 10.1: the engine is fetched on the first computer game; meanwhile the Start pill shows
 * the Ztyle spinner with progress. Usage on the Start tap for a computer game:
 * `if (await engineStart.prepare()) gs.start();`
 */
export function useEngineStart(engine: EngineApi, opts: UseEngineStartOptions = {}): EngineStart {
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const onFailRef = useRef(opts.onFail);
  onFailRef.current = opts.onFail;
  const gen = useRef(0);
  const [waiting, setWaiting] = useState(false);

  // Unmount: a `prepare` still waiting resolves false.
  useEffect(() => {
    const counter = gen;
    return () => {
      counter.current++;
    };
  }, []);

  const prepare = useCallback(async (): Promise<boolean> => {
    const e = engineRef.current;
    if (e.state === 'ready') return true;
    const my = ++gen.current;
    setWaiting(true);
    try {
      await e.load();
      if (my !== gen.current) return false;
      setWaiting(false);
      return true;
    } catch (err) {
      if (my !== gen.current) return false;
      setWaiting(false);
      onFailRef.current?.(err);
      return false;
    }
  }, []);

  const cancel = useCallback(() => {
    gen.current++;
    setWaiting(false);
  }, []);

  const loading = waiting && engine.state !== 'ready';
  return { loading, progress: loading ? engine.progress : 0, prepare, cancel };
}

export default useComputer;
