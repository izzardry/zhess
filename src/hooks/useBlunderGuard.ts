/**
 * Blunder guard (DESIGN 7.2): against the computer, with helpers on.
 *
 * - When the player's turn begins, the engine starts evaluating the position (the "before"
 *   evaluation), so that at drop time only the "after" search has to run (PLAN 7).
 * - `check(uci)` is called with the dropped move BEFORE it is played. It evaluates the position
 *   after the move at `GUARD_DEPTH` and answers within about `GUARD_BUDGET_MS`:
 *   - `commit`: play the move (not a blunder, engine late, guard off, or the confirmation of a
 *     move refused less than 5 s ago);
 *   - `refuse`: do not play it; the piece stays on `square`, which pulses red once
 *     (`blunder` / `blunderKey` feed the board's `highlights`);
 *   - `stale`: the position changed or a newer check started meanwhile; do nothing.
 * - Engine not ready at drop time (still loading, or failed): the chess.js fallback decides at once
 *   (mate in 1, hanging piece).
 * - Premoves bypass the guard (DESIGN 6.3): the caller plays them without `check`.
 *
 * The guard never calls `engine.stop()` (that would cancel the computer's and the hint's searches
 * too); it relies on the evaluation timeouts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BEFORE_TIMEOUT_MS,
  CONFIRM_WINDOW_MS,
  GUARD_BUDGET_MS,
  GUARD_DEPTH,
  fallbackVerdict,
  isConfirmation,
  judgeEvals,
  refusedSquare,
  type BlunderReason,
  type Refusal,
  type Verdict,
} from '@/lib/blunder';
import type { Color, EngineApi, Eval, Game, Now, Square, Uci } from '@/lib/types';
import { play } from '@/lib/zhess';

export interface UseBlunderGuardOptions {
  /** The shared engine (`useZhessEngine()`). */
  engine: EngineApi;
  /** The live game (`session.game`), or null. */
  game: Game | null;
  /**
   * Guard on: computer mode, helpers on, `flags.blunderGuard`, live (not review, not over).
   * While false, `check` commits at once and no evaluation is started.
   */
  enabled: boolean;
  /** The player's color (`session.color`). The guard only runs on the player's turn. */
  playerColor: Color | null;
  /** Clock for the 5-second window. Default `Date.now`. */
  now?: Now;
  /** Default `GUARD_BUDGET_MS`. */
  budgetMs?: number;
  /** Default `GUARD_DEPTH`. */
  depth?: number;
  /** Default `CONFIRM_WINDOW_MS`. */
  confirmMs?: number;
}

export type BlunderCheck =
  | { readonly action: 'commit' }
  | { readonly action: 'refuse'; readonly square: Square; readonly reason: BlunderReason }
  | { readonly action: 'stale' };

export interface BlunderGuard {
  /** True when moves of the player go through `check` now (enabled, live, player's turn). */
  readonly active: boolean;
  /** Decide on a dropped move; see the file comment. Never rejects. */
  check(uci: Uci): Promise<BlunderCheck>;
  /** The move being checked (canonical UCI), for an optimistic board while the check runs; else null. */
  readonly checking: Uci | null;
  /** From-square of the last refused move (pulses red), until the position changes. */
  readonly blunder: Square | null;
  /** Increases with every refusal, so the same square pulses again. */
  readonly blunderKey: number;
  /** Forget the refusal and the pulse. */
  clear(): void;
}

const COMMIT: BlunderCheck = Object.freeze({ action: 'commit' });
const STALE: BlunderCheck = Object.freeze({ action: 'stale' });

interface BeforeEntry {
  fen: string;
  promise: Promise<Eval | null>;
  /** undefined while pending. */
  value?: Eval | null;
}

/** Resolves with `p`'s value, or null when `ms` pass first. */
function withDeadline<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.race([p, Promise.resolve(null)]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function safeEvaluate(engine: EngineApi, fen: string, depth: number, timeoutMs: number): Promise<Eval | null> {
  try {
    return engine.evaluate(fen, depth, timeoutMs).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

export function useBlunderGuard(opts: UseBlunderGuardOptions): BlunderGuard {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const now = useCallback(() => (optsRef.current.now ? optsRef.current.now() : Date.now()), []);

  const { game, enabled, playerColor } = opts;
  const fen = game?.fen ?? null;
  const active = enabled && !!game && !game.end && game.turn === playerColor;

  const before = useRef<BeforeEntry | null>(null);
  const refusal = useRef<Refusal | null>(null);
  const checkGen = useRef(0);
  const [checking, setChecking] = useState<Uci | null>(null);
  const [pulse, setPulse] = useState<{ square: Square | null; key: number }>({ square: null, key: 0 });

  /* ---- "before" evaluation as soon as the player's turn begins ---- */
  useEffect(() => {
    if (!active || !fen) return;
    if (before.current?.fen === fen) return;
    const o = optsRef.current;
    const entry: BeforeEntry = {
      fen,
      promise: safeEvaluate(o.engine, fen, o.depth ?? GUARD_DEPTH, BEFORE_TIMEOUT_MS),
    };
    entry.promise.then((v) => {
      entry.value = v;
    });
    before.current = entry;
  }, [active, fen]);

  /* ---- a new position: the pulse and the refusal belong to the old one ---- */
  useEffect(() => {
    setPulse((p) => (p.square ? { square: null, key: p.key } : p));
    setChecking(null);
    checkGen.current++;
  }, [fen]);

  const check = useCallback(
    async (uci: Uci): Promise<BlunderCheck> => {
      const o = optsRef.current;
      const g = o.game;
      if (!o.enabled || !g || g.end || g.turn !== o.playerColor) return COMMIT;
      let canon: Uci;
      let afterFen: string;
      let mates = false;
      try {
        const next = play(g, uci, 0);
        canon = next.plies[next.cursor - 1].m;
        afterFen = next.fen;
        mates = next.end?.by === 'mate';
      } catch {
        // Illegal: not the guard's business; the caller's move() refuses it.
        return COMMIT;
      }
      const t0 = now();
      if (isConfirmation(refusal.current, g.fen, canon, t0, o.confirmMs ?? CONFIRM_WINDOW_MS)) {
        refusal.current = null;
        return COMMIT;
      }
      if (mates) return COMMIT;

      const id = ++checkGen.current;
      setChecking(canon);
      const budget = Math.max(0, o.budgetMs ?? GUARD_BUDGET_MS);
      const depth = o.depth ?? GUARD_DEPTH;
      let verdict: Verdict;
      try {
        if (o.engine.state !== 'ready') {
          verdict = fallbackVerdict(g.fen, canon);
        } else {
          const cached = before.current;
          // Reuse the turn's evaluation unless it already came back empty; otherwise ask again
          // (it then shares the budget with the "after" search).
          const beforeP =
            cached && cached.fen === g.fen && cached.value !== null
              ? cached.promise
              : safeEvaluate(o.engine, g.fen, depth, budget);
          const afterP = safeEvaluate(o.engine, afterFen, depth, budget);
          const [b, a] = await Promise.all([withDeadline(beforeP, budget), withDeadline(afterP, budget)]);
          verdict = judgeEvals(b, a);
        }
      } catch {
        verdict = { flag: false };
      }

      if (id !== checkGen.current || optsRef.current.game?.fen !== g.fen) return STALE;
      setChecking(null);
      if (!verdict.flag) return COMMIT;
      const square = refusedSquare(canon);
      refusal.current = { fen: g.fen, uci: canon, at: now() };
      setPulse((p) => ({ square, key: p.key + 1 }));
      return { action: 'refuse', square, reason: verdict.reason ?? 'drop' };
    },
    [now],
  );

  const clear = useCallback(() => {
    refusal.current = null;
    setPulse((p) => (p.square ? { square: null, key: p.key } : p));
  }, []);

  return { active, check, checking, blunder: pulse.square, blunderKey: pulse.key, clear };
}

export default useBlunderGuard;
