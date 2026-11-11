/**
 * Hint bulb (DESIGN 7.3), the tap part. The 1-second hold (threat peek) is chess.js only; see
 * `threatSquares` below and the page's existing wiring.
 *
 * - Tap 1: the engine's best move for the side to move is searched at full strength; its from-square
 *   pulses green (`squares` → `highlights.hint`). The game is marked assisted (`onAssisted`).
 * - Tap 2: its target square pulses.
 * - Further taps alternate between the two, replaying the pulse (a new array each time).
 * - Any change of position (a move, undo, redo) or of the session forgets the hint; an answer that
 *   arrives for an old position is ignored. The hint never plays the move.
 *
 * Available against the computer (on the player's turn) and in pass-and-play (for the side to move).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isEngineAbort } from '@/lib/engine/driver';
import { attacked } from '@/lib/zhess';
import type { Color, EngineApi, Game, Square, Uci } from '@/lib/types';
import { playableMove } from './useComputer';

/** Depth of the hint search (MultiPV 1 at full strength). */
export const HINT_DEPTH = 12;

export interface UseHintOptions {
  /** The shared engine (`useZhessEngine()`). */
  engine: EngineApi;
  /** The live game (`session.game`), or null. */
  game: Game | null;
  /**
   * Hint allowed now: `flags.hint`, computer or pass-and-play, phase `playing`, game not over, and
   * against the computer only on the player's turn.
   */
  enabled: boolean;
  /** First hint shown in this position: mark the game assisted (`useGameState.markAssisted`). */
  onAssisted?: () => void;
  /** The engine is unavailable (not called for a cancelled search). */
  onFail?: (error: unknown) => void;
  /** Session identity (`session.id`); a change forgets the hint. */
  sessionKey?: string | null;
  /** Default `HINT_DEPTH`. */
  depth?: number;
}

export interface HintState {
  /** The bulb's tap. */
  tap(): void;
  /** Squares to pulse (`highlights.hint`), or undefined. A new array on every tap. */
  readonly squares: readonly Square[] | undefined;
  /** 0 = nothing shown, 1 = from-square shown, 2 = target shown. */
  readonly step: 0 | 1 | 2;
  /** The hinted move (canonical UCI), once known. */
  readonly move: Uci | null;
  /** Waiting for the engine (show the bulb busy, `game.hintLoading` while the engine loads). */
  readonly pending: boolean;
  /** Forget the hint. */
  reset(): void;
}

interface Shown {
  key: string;
  move: Uci;
  step: 1 | 2;
  squares: readonly Square[];
}

export function useHint(opts: UseHintOptions): HintState {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { game, sessionKey = null } = opts;
  const key = game ? `${sessionKey ?? ''}|${game.cursor}|${game.fen}` : null;
  const keyRef = useRef(key);
  keyRef.current = key;

  const [shown, setShown] = useState<Shown | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const searchGen = useRef(0);

  // A new position forgets the hint and ignores answers still on their way.
  useEffect(() => {
    searchGen.current++;
    setShown(null);
    setPendingKey(null);
  }, [key]);

  const tap = useCallback(() => {
    const o = optsRef.current;
    const g = o.game;
    const k = keyRef.current;
    if (!o.enabled || !g || g.end || !k) return;
    if (shown && shown.key === k) {
      // Tap 2 shows the target; later taps alternate and replay the pulse.
      const next: 1 | 2 = shown.step === 1 ? 2 : 1;
      const sq = (next === 1 ? shown.move.slice(0, 2) : shown.move.slice(2, 4)) as Square;
      setShown({ ...shown, step: next, squares: [sq] });
      return;
    }
    if (pendingKey === k) return;
    const my = ++searchGen.current;
    setPendingKey(k);
    let p: Promise<{ uci: Uci }[]>;
    try {
      p = o.engine.multiPv(g.fen, 1, o.depth ?? HINT_DEPTH);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (lines) => {
        if (my !== searchGen.current || keyRef.current !== k) return;
        setPendingKey(null);
        const move = playableMove(g.fen, lines[0]?.uci);
        if (!move) return;
        setShown({ key: k, move, step: 1, squares: [move.slice(0, 2) as Square] });
        optsRef.current.onAssisted?.();
      },
      (err: unknown) => {
        if (my !== searchGen.current) return;
        setPendingKey(null);
        if (!isEngineAbort(err)) optsRef.current.onFail?.(err);
      },
    );
  }, [shown, pendingKey]);

  const reset = useCallback(() => {
    searchGen.current++;
    setShown(null);
    setPendingKey(null);
  }, []);

  const current = shown && shown.key === key ? shown : null;
  return {
    tap,
    squares: current?.squares,
    step: current?.step ?? 0,
    move: current?.move ?? null,
    pending: pendingKey !== null && pendingKey === key,
    reset,
  };
}

/**
 * Threat peek (DESIGN 7.3, hold 1 s): the squares the opponent of `viewer` attacks. In pass-and-play
 * the viewer is the side to move; against the computer it is the player.
 */
export function threatSquares(g: Game, viewer: Color): Square[] {
  return attacked(g, viewer === 'w' ? 'b' : 'w');
}

export default useHint;
