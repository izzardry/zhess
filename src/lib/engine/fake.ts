/**
 * FakeEngine: a deterministic `EngineApi` (plus the hook's `EngineHandle` extras) for tests.
 *
 * - `load()`: idle → loading (progress 0, then 0.5) → ready (1), after `loadMs` (0 = microtasks).
 *   With `loadResult: 'fail'` it ends in `failed` and rejects; a later `load()` tries again
 *   (call `setLoadResult('ready')` first to let it succeed).
 * - Searches load lazily like the real engine and take `delayMs` (0 = microtasks only).
 * - `bestMove`: the scripted move for the FEN (`moves`), else the first legal move in chess.js order.
 * - `evaluate`: the scripted eval (`evals`; `null` there simulates no answer), else `materialEval`.
 *   Resolves null when `delayMs > timeoutMs`, after `timeoutMs`.
 * - `multiPv`: every legal move scored one ply deep (scripted eval of the position after it,
 *   negated, else the material eval), best first, the first `n`.
 * - `stop()`: pending `bestMove` / `multiPv` reject with an `AbortError`, pending `evaluate` resolve null.
 * - `calls` records every call; `stops` counts `stop()` calls.
 *
 * Scripted maps are keyed by FEN; a key matches the full FEN or its first four fields
 * (placement, side, castling, en passant).
 */
import { Chess, type Square as ChessSquare } from 'chess.js';
import type { EngineState, Eval, Uci } from '../types';
import { negateEval, scoreCp } from './uci.ts';
import { EngineAbortError, EngineUnavailableError, type EngineHandle, type EngineSnapshot } from './driver.ts';

export type FakeMoves = Readonly<Record<string, Uci>> | ((fen: string, level: number) => Uci | undefined);
export type FakeEvals = Readonly<Record<string, Eval | null>> | ((fen: string, depth: number) => Eval | null | undefined);

export interface FakeEngineOptions {
  loadResult?: 'ready' | 'fail';
  loadMs?: number;
  delayMs?: number;
  moves?: FakeMoves;
  evals?: FakeEvals;
}

export type FakeCall =
  | { method: 'load'; args: [] }
  | { method: 'bestMove'; args: [fen: string, level: number, clock?: { wMs: number; bMs: number; incMs: number }] }
  | { method: 'evaluate'; args: [fen: string, depth: number, timeoutMs?: number] }
  | { method: 'multiPv'; args: [fen: string, n: number, depth: number] };

const PIECE_CP: Record<string, number> = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

function fenKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

function lookup<T>(map: Readonly<Record<string, T>>, fen: string): T | undefined {
  if (Object.prototype.hasOwnProperty.call(map, fen)) return map[fen];
  const key = fenKey(fen);
  for (const k of Object.keys(map)) if (fenKey(k) === key) return map[k];
  return undefined;
}

function chess(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

function toUci(m: { from: string; to: string; promotion?: string }): Uci {
  return m.from + m.to + (m.promotion ?? '');
}

/**
 * Material evaluation from the side to move: `{ mate: 0 }` when mated, `{ mate: 1 }` when the side
 * to move mates in one, `{ cp: 0 }` on a drawn position, else the material difference in cp
 * (P 100, N 300, B 300, R 500, Q 900). `{ cp: 0 }` for a bad FEN.
 */
export function materialEval(fen: string): Eval {
  const c = chess(fen);
  if (!c) return { cp: 0 };
  if (c.isCheckmate()) return { mate: 0 };
  if (c.isDraw() || c.isStalemate()) return { cp: 0 };
  if (c.moves().some((san) => san.endsWith('#'))) return { mate: 1 };
  const me = c.turn();
  let cp = 0;
  for (const row of c.board()) {
    for (const sq of row) {
      if (!sq) continue;
      cp += (sq.color === me ? 1 : -1) * PIECE_CP[sq.type];
    }
  }
  return { cp };
}

interface Pending {
  abort(): void;
}

export class FakeEngine implements EngineHandle {
  readonly calls: FakeCall[] = [];
  stops = 0;

  private snapshot: EngineSnapshot = { state: 'idle', progress: 0 };
  private readonly listeners = new Set<() => void>();
  private loadPromise: Promise<void> | null = null;
  private readonly pending = new Set<Pending>();
  private loadResult: 'ready' | 'fail';
  private disposed = false;
  private readonly opts: FakeEngineOptions;

  constructor(opts: FakeEngineOptions = {}) {
    this.opts = opts;
    this.loadResult = opts.loadResult ?? 'ready';
  }

  get state(): EngineState {
    return this.snapshot.state;
  }

  get progress(): number {
    return this.snapshot.progress;
  }

  /** Change what the next `load()` does. */
  setLoadResult(r: 'ready' | 'fail'): void {
    this.loadResult = r;
  }

  readonly getSnapshot = (): EngineSnapshot => this.snapshot;

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private set(state: EngineState, progress: number): void {
    if (state === this.snapshot.state && progress === this.snapshot.progress) return;
    this.snapshot = Object.freeze({ state, progress });
    for (const cb of [...this.listeners]) cb();
  }

  private wait(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  readonly load = (): Promise<void> => {
    this.calls.push({ method: 'load', args: [] });
    return this.ensureLoaded();
  };

  private ensureLoaded(): Promise<void> {
    if (this.disposed) return Promise.reject(new EngineUnavailableError('Engine disposed'));
    if (this.snapshot.state === 'ready') return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.set('loading', 0);
    const ms = this.opts.loadMs ?? 0;
    this.loadPromise = (async () => {
      await this.wait(ms / 2);
      this.set('loading', 0.5);
      await this.wait(ms / 2);
      this.loadPromise = null;
      if (this.loadResult === 'fail') {
        this.set('failed', 0);
        throw new EngineUnavailableError('Fake engine failed to load');
      }
      this.set('ready', 1);
    })();
    return this.loadPromise;
  }

  /**
   * Runs `fn` after loading and `delayMs`, unless `stop()` comes first (then `onAbort`), the timeout
   * fires (then `onTimeout`) or loading fails (then `onFail`, else the load error rejects).
   */
  private search<T>(
    fn: () => T,
    onAbort: () => T,
    o: { timeoutMs?: number; onTimeout?: () => T; onFail?: () => T } = {},
  ): Promise<T> {
    const { timeoutMs, onTimeout, onFail } = o;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const entry: Pending = {
        abort: () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.pending.delete(entry);
          try {
            resolve(onAbort());
          } catch (e) {
            reject(e);
          }
        },
      };
      this.pending.add(entry);
      const finish = (f: () => T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(entry);
        try {
          resolve(f());
        } catch (e) {
          reject(e);
        }
      };
      if (timeoutMs !== undefined && onTimeout) timer = setTimeout(() => finish(onTimeout), Math.max(0, timeoutMs));
      this.ensureLoaded()
        .then(() => this.wait(this.opts.delayMs ?? 0))
        .then(
          () => finish(fn),
          (err) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            this.pending.delete(entry);
            if (onFail) resolve(onFail());
            else reject(err);
          },
        );
    });
  }

  private scriptedEval(fen: string, depth: number): Eval | null | undefined {
    const e = this.opts.evals;
    if (!e) return undefined;
    return typeof e === 'function' ? e(fen, depth) : lookup(e, fen);
  }

  private evalOf(fen: string, depth: number): Eval | null {
    const s = this.scriptedEval(fen, depth);
    return s === undefined ? materialEval(fen) : s;
  }

  readonly bestMove = (
    fen: string,
    level: number,
    clock?: { wMs: number; bMs: number; incMs: number },
  ): Promise<Uci> => {
    this.calls.push({ method: 'bestMove', args: clock ? [fen, level, clock] : [fen, level] });
    return this.search(
      () => {
        const m = this.opts.moves;
        const scripted = m ? (typeof m === 'function' ? m(fen, level) : lookup(m, fen)) : undefined;
        if (scripted) return scripted;
        const first = chess(fen)?.moves({ verbose: true })[0];
        if (!first) throw new Error('No legal move in this position');
        return toUci(first);
      },
      () => {
        throw new EngineAbortError();
      },
    );
  };

  readonly evaluate = (fen: string, depth: number, timeoutMs?: number): Promise<Eval | null> => {
    this.calls.push({ method: 'evaluate', args: timeoutMs === undefined ? [fen, depth] : [fen, depth, timeoutMs] });
    return this.search(
      () => this.evalOf(fen, depth),
      () => null,
      { timeoutMs, onTimeout: () => null, onFail: () => null },
    );
  };

  readonly multiPv = (fen: string, n: number, depth: number): Promise<{ uci: Uci; eval: Eval }[]> => {
    this.calls.push({ method: 'multiPv', args: [fen, n, depth] });
    return this.search(
      () => {
        const c = chess(fen);
        if (!c) return [];
        const scored = c.moves({ verbose: true }).map((m, i) => {
          c.move({ from: m.from as ChessSquare, to: m.to as ChessSquare, promotion: m.promotion });
          const afterFen = c.fen();
          c.undo();
          const e = this.evalOf(afterFen, Math.max(0, depth - 1)) ?? { cp: 0 };
          const ev = negateEval(e);
          return { uci: toUci(m), eval: ev, i, s: scoreCp(ev) };
        });
        scored.sort((a, b) => b.s - a.s || a.i - b.i);
        return scored.slice(0, Math.max(1, n)).map(({ uci, eval: ev }) => ({ uci, eval: ev }));
      },
      () => {
        throw new EngineAbortError();
      },
    );
  };

  readonly stop = (): void => {
    this.stops++;
    for (const p of [...this.pending]) p.abort();
  };

  readonly dispose = (): void => {
    this.stop();
    this.disposed = true;
    this.set('idle', 0);
    this.listeners.clear();
  };
}
