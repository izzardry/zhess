/**
 * `useZhessEngine`: React access to the one shared Stockfish worker (DESIGN 10.1).
 *
 * The computer opponent, the hint and the blunder guard all call this hook and get the same engine,
 * so there is only ever one worker and one search queue. Nothing is fetched until the first
 * `load()` or search. The returned object changes identity when `state` or `progress` changes;
 * its methods are stable.
 *
 * Tests (and the integrator) can replace the shared engine with `setSharedEngine(new FakeEngine())`
 * or pass an engine to the hook directly.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { EngineApi } from '@/lib/types';
import type { EngineHandle } from '@/lib/engine/driver';
import { createBrowserEngine } from '@/lib/engine/browser';

let shared: EngineHandle | null = null;

/** The app-wide engine, created on first use (no worker is started until it is used). */
export function sharedEngine(): EngineHandle {
  if (!shared) shared = createBrowserEngine();
  return shared;
}

/**
 * Replace the shared engine (tests, or a different engine). Pass null to go back to the browser
 * engine on next use. The previous engine is not disposed; that is the caller's choice.
 */
export function setSharedEngine(engine: EngineHandle | null): void {
  shared = engine;
}

/** The shared engine as `EngineApi`, re-rendering on state and progress changes. */
export function useZhessEngine(engine?: EngineHandle): EngineApi {
  const e = engine ?? sharedEngine();
  const methods = useMemo(
    () => ({
      subscribe: (cb: () => void) => e.subscribe(cb),
      getSnapshot: () => e.getSnapshot(),
      load: () => e.load(),
      bestMove: (...a: Parameters<EngineApi['bestMove']>) => e.bestMove(...a),
      evaluate: (...a: Parameters<EngineApi['evaluate']>) => e.evaluate(...a),
      multiPv: (...a: Parameters<EngineApi['multiPv']>) => e.multiPv(...a),
      stop: () => e.stop(),
    }),
    [e],
  );
  const snap = useSyncExternalStore(methods.subscribe, methods.getSnapshot, methods.getSnapshot);
  return useMemo<EngineApi>(
    () => ({
      state: snap.state,
      progress: snap.progress,
      load: methods.load,
      bestMove: methods.bestMove,
      evaluate: methods.evaluate,
      multiPv: methods.multiPv,
      stop: methods.stop,
    }),
    [methods, snap],
  );
}
