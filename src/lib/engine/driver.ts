/**
 * The engine bridge: `EngineApi` over any UCI text port (DESIGN 10.1).
 *
 * Framework-free. The browser plugs in a Web Worker port (`./browser.ts`), Node plugs in the same
 * engine file loaded in-process (`./node.ts`), tests plug in a scripted port. React access goes
 * through `hooks/useZhessEngine.ts`, which keeps one shared instance so the computer, the hint and
 * the blunder guard use one worker.
 *
 * Rules:
 * - Lazy: nothing is fetched until `load()` or the first search. A search started while the engine
 *   loads waits in the queue; its timeout (if any) counts from the call.
 * - One search at a time. Searches queue in call order. Options (`MultiPV`, `Skill Level`) are set
 *   per search, only when they change, and only when the engine offers them.
 * - `stop()` cancels everything: queued searches and the running one settle at once (bestMove and
 *   multiPv reject with an `AbortError`, evaluate resolves null) and the engine is told `stop`.
 *   The next search starts only after the engine has answered the stopped one with `bestmove`.
 * - `evaluate(…, timeoutMs)` resolves null when the answer is not there in time (queue wait and
 *   loading included); a running search is then stopped.
 * - Failure (worker error, no handshake within `initTimeoutMs`, a hung search): state `failed`;
 *   pending searches settle (evaluate → null, others reject). The next `load()` or search retries.
 *
 * Imports carry explicit `.ts` extensions so that Node can load this file for `scripts/selfplay.mjs`.
 */
import type { EngineApi, EngineState, Eval, Uci } from '../types';
import {
  SearchCollector,
  fenTurn,
  goCommand,
  isReadyOk,
  isUciOk,
  parseBestMove,
  parseInfo,
  parseOption,
  positionCommand,
  setOptionCommand,
  type GoParams,
  type UciOption,
} from './uci.ts';
import {
  NEVER_MATE_IN_1_FROM,
  allowsMateIn1,
  clockCapMs,
  engineMovetime,
  humanizedPlan,
  levelSpec,
  pickMove,
  type EngineClock,
} from '../levels.ts';

/* ------------------------------------------------------------------------------------------------
 * Ports
 * --------------------------------------------------------------------------------------------- */

/** Callbacks a port reports to. Lines arrive one by one, already split and trimmed. */
export interface PortHandlers {
  onLine(line: string): void;
  onError(err: Error): void;
  /** Download progress of the engine files, 0..1. Optional for a port to report. */
  onProgress(p: number): void;
}

/** A UCI text channel to one engine instance. */
export interface UciPort {
  send(cmd: string): void;
  terminate(): void;
}

/** Creates a port; may throw (for example when Workers are not available). */
export type PortFactory = (handlers: PortHandlers) => UciPort;

/* ------------------------------------------------------------------------------------------------
 * Public types
 * --------------------------------------------------------------------------------------------- */

export interface EngineSnapshot {
  readonly state: EngineState;
  readonly progress: number;
}

/** `EngineApi` plus what the React hook needs to subscribe to state changes. */
export interface EngineHandle extends EngineApi {
  /** Called after every change of `state` or `progress`. Returns the unsubscribe function. */
  subscribe(cb: () => void): () => void;
  /** Immutable `{ state, progress }`; a new object after each change (for `useSyncExternalStore`). */
  getSnapshot(): EngineSnapshot;
  /** Stop, terminate the worker and refuse further work. */
  dispose(): void;
}

/** Rejection of `bestMove` / `multiPv` cancelled by `stop()`. */
export class EngineAbortError extends Error {
  constructor(message = 'Engine search stopped') {
    super(message);
    this.name = 'AbortError';
  }
}

/** Rejection when the engine cannot be loaded or crashed. */
export class EngineUnavailableError extends Error {
  constructor(message = 'Engine unavailable') {
    super(message);
    this.name = 'EngineUnavailableError';
  }
}

/** True for the rejection a `stop()` causes. */
export function isEngineAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export interface EngineDriverOptions {
  createPort: PortFactory;
  /** Randomness of the humanized picker. Default `Math.random`. */
  rng?: () => number;
  /** Give up loading when the engine shows no sign of life (progress or output) for this long. Default 30 s. */
  initTimeoutMs?: number;
  /** A search that has not answered this long after its move time is stopped, then the engine is failed. Default 30 s. */
  watchdogMs?: number;
}

/* ------------------------------------------------------------------------------------------------
 * Internals
 * --------------------------------------------------------------------------------------------- */

type Outcome =
  | { readonly status: 'done'; readonly bestmove: Uci | null; readonly collector: SearchCollector }
  | { readonly status: 'timeout' }
  | { readonly status: 'aborted' }
  | { readonly status: 'failed'; readonly error: Error };

interface SearchRequest {
  readonly fen: string;
  readonly go: GoParams;
  readonly options: Readonly<Record<string, string | number | boolean>>;
  readonly timeoutMs?: number;
}

interface Job extends SearchRequest {
  readonly collector: SearchCollector;
  settled: boolean;
  stopSent: boolean;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  settle(o: Outcome): void;
}

const STOP_GRACE_MS = 3000;
const SKILL = 'Skill Level';
const MULTIPV = 'MultiPV';

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/* ------------------------------------------------------------------------------------------------
 * Driver
 * --------------------------------------------------------------------------------------------- */

export class EngineDriver implements EngineHandle {
  private readonly createPort: PortFactory;
  private readonly rng: () => number;
  private readonly initTimeoutMs: number;
  private readonly watchdogMs: number;

  private snapshot: EngineSnapshot = { state: 'idle', progress: 0 };
  private readonly listeners = new Set<() => void>();

  private port: UciPort | null = null;
  /** Incremented per port so late events of a terminated port are ignored. */
  private generation = 0;
  private phase: 'none' | 'uci' | 'isready' | 'ready' = 'none';
  private initTimer?: ReturnType<typeof setTimeout>;
  private loadPromise: Promise<void> | null = null;
  private loadSettle: { resolve: () => void; reject: (e: Error) => void } | null = null;

  /** Options the engine announced in its `uci` handshake, by name. */
  readonly engineOptions = new Map<string, UciOption>();
  private readonly optionValues = new Map<string, string>();

  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private watchdog?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(opts: EngineDriverOptions) {
    this.createPort = opts.createPort;
    this.rng = opts.rng ?? Math.random;
    this.initTimeoutMs = opts.initTimeoutMs ?? 30_000;
    this.watchdogMs = opts.watchdogMs ?? 30_000;
  }

  /* ---------------------------------------------------------------- state */

  get state(): EngineState {
    return this.snapshot.state;
  }

  get progress(): number {
    return this.snapshot.progress;
  }

  /** True once loaded when the build offers UCI `Skill Level` (stockfish.js 19.0.1 does). */
  get hasSkillLevel(): boolean {
    return this.engineOptions.has(SKILL);
  }

  readonly getSnapshot = (): EngineSnapshot => this.snapshot;

  readonly subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private set(state: EngineState, progress: number): void {
    const p = Math.min(1, Math.max(0, progress));
    if (state === this.snapshot.state && p === this.snapshot.progress) return;
    this.snapshot = Object.freeze({ state, progress: p });
    for (const cb of [...this.listeners]) cb();
  }

  /* ---------------------------------------------------------------- loading */

  readonly load = (): Promise<void> => {
    if (this.disposed) return Promise.reject(new EngineUnavailableError('Engine disposed'));
    if (this.snapshot.state === 'ready') return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    const promise = new Promise<void>((resolve, reject) => {
      this.loadSettle = { resolve, reject };
    });
    this.loadPromise = promise;
    this.set('loading', 0);
    this.engineOptions.clear();
    this.optionValues.clear();

    const gen = ++this.generation;
    const alive = () => gen === this.generation && !this.disposed;
    try {
      this.port = this.createPort({
        onLine: (line) => {
          if (alive()) this.onLine(line);
        },
        onError: (err) => {
          if (alive()) this.fail(err);
        },
        onProgress: (p) => {
          if (!alive() || this.phase === 'ready') return;
          this.armInitTimer();
          if (Number.isFinite(p)) this.set('loading', Math.max(this.snapshot.progress, Math.min(1, p) * 0.9));
        },
      });
      this.phase = 'uci';
      this.armInitTimer();
      this.port.send('uci');
    } catch (e) {
      this.fail(toError(e));
    }
    return promise;
  };

  private armInitTimer(): void {
    clearTimeout(this.initTimer);
    this.initTimer = setTimeout(() => {
      if (this.phase !== 'ready') this.fail(new EngineUnavailableError('Engine did not start in time'));
    }, this.initTimeoutMs);
  }

  private onLine(line: string): void {
    if (this.phase === 'uci') {
      this.armInitTimer();
      const opt = parseOption(line);
      if (opt) this.engineOptions.set(opt.name, opt);
      if (isUciOk(line)) {
        this.phase = 'isready';
        this.set('loading', Math.max(this.snapshot.progress, 0.95));
        this.port?.send('isready');
      }
      return;
    }
    if (this.phase === 'isready') {
      if (isReadyOk(line)) this.becomeReady();
      return;
    }
    if (this.phase !== 'ready') return;
    const job = this.running;
    if (!job) return;
    const info = parseInfo(line);
    if (info) job.collector.add(info);
    const best = parseBestMove(line);
    if (best) this.finish(job, best.move);
  }

  private becomeReady(): void {
    clearTimeout(this.initTimer);
    this.phase = 'ready';
    this.set('ready', 1);
    const settle = this.loadSettle;
    this.loadSettle = null;
    this.loadPromise = null;
    settle?.resolve();
    this.pump();
  }

  private fail(err: Error): void {
    clearTimeout(this.initTimer);
    clearTimeout(this.watchdog);
    this.generation++;
    this.phase = 'none';
    const port = this.port;
    this.port = null;
    try {
      port?.terminate();
    } catch {
      /* already gone */
    }
    const error = err instanceof EngineUnavailableError ? err : new EngineUnavailableError(err.message);
    const jobs = [...(this.running ? [this.running] : []), ...this.queue.splice(0)];
    this.running = null;
    for (const j of jobs) j.settle({ status: 'failed', error });
    this.set(this.disposed ? 'idle' : 'failed', 0);
    const settle = this.loadSettle;
    this.loadSettle = null;
    this.loadPromise = null;
    settle?.reject(error);
  }

  /* ---------------------------------------------------------------- queue */

  private enqueue(req: SearchRequest): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const job: Job = {
        ...req,
        collector: new SearchCollector(),
        settled: false,
        stopSent: false,
        settle: (o) => {
          if (job.settled) return;
          job.settled = true;
          clearTimeout(job.deadlineTimer);
          resolve(o);
        },
      };
      if (this.disposed) {
        job.settle({ status: 'failed', error: new EngineUnavailableError('Engine disposed') });
        return;
      }
      if (req.timeoutMs !== undefined) {
        job.deadlineTimer = setTimeout(() => this.onDeadline(job), Math.max(0, req.timeoutMs));
      }
      this.queue.push(job);
      const s = this.snapshot.state;
      if (s === 'idle' || s === 'failed') this.load().catch(() => undefined);
      else this.pump();
    });
  }

  private pump(): void {
    if (this.phase !== 'ready' || this.running || !this.port) return;
    let job = this.queue.shift();
    while (job && job.settled) job = this.queue.shift();
    if (!job) return;
    this.running = job;
    const port = this.port;
    for (const [name, value] of Object.entries(job.options)) {
      if (!this.engineOptions.has(name)) continue;
      const v = String(value);
      if (this.optionValues.get(name) === v) continue;
      this.optionValues.set(name, v);
      port.send(setOptionCommand(name, v));
    }
    port.send(positionCommand(job.fen));
    port.send(goCommand(job.go));
    this.armWatchdog(job);
  }

  private armWatchdog(job: Job): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.running !== job) return;
      this.sendStop(job);
      this.watchdog = setTimeout(() => {
        if (this.running === job) this.fail(new EngineUnavailableError('Engine stopped answering'));
      }, STOP_GRACE_MS);
    }, (job.go.movetime ?? 0) + this.watchdogMs);
  }

  private sendStop(job: Job): void {
    if (job.stopSent || this.running !== job) return;
    job.stopSent = true;
    this.port?.send('stop');
  }

  private finish(job: Job, bestmove: Uci | null): void {
    clearTimeout(this.watchdog);
    this.running = null;
    job.settle({ status: 'done', bestmove, collector: job.collector });
    this.pump();
  }

  private onDeadline(job: Job): void {
    if (job.settled) return;
    const i = this.queue.indexOf(job);
    if (i >= 0) this.queue.splice(i, 1);
    job.settle({ status: 'timeout' });
    this.sendStop(job);
  }

  /** Cancel the running search and everything queued (see the file comment). */
  readonly stop = (): void => {
    for (const j of this.queue.splice(0)) j.settle({ status: 'aborted' });
    const job = this.running;
    if (job) {
      job.settle({ status: 'aborted' });
      this.sendStop(job);
    }
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.fail(new EngineUnavailableError('Engine disposed'));
    this.listeners.clear();
  };

  /* ---------------------------------------------------------------- API */

  /** Full-strength options for analysis searches. */
  private analysis(multiPv: number): Record<string, number> {
    const max = this.engineOptions.get(MULTIPV)?.max ?? 256;
    return { [MULTIPV]: Math.min(max, Math.max(1, Math.round(multiPv))), [SKILL]: 20 };
  }

  readonly evaluate = async (fen: string, depth: number, timeoutMs?: number): Promise<Eval | null> => {
    const o = await this.enqueue({ fen, go: { depth: Math.max(1, depth) }, options: this.analysis(1), timeoutMs });
    if (o.status !== 'done') return null;
    return o.collector.eval();
  };

  readonly multiPv = async (fen: string, n: number, depth: number): Promise<{ uci: Uci; eval: Eval }[]> => {
    const o = await this.enqueue({ fen, go: { depth: Math.max(1, depth) }, options: this.analysis(n) });
    return linesOf(o)
      .slice(0, Math.max(1, n))
      .map((l) => ({ uci: l.uci, eval: l.eval }));
  };

  readonly bestMove = async (fen: string, level: number, clock?: EngineClock): Promise<Uci> => {
    await this.load();
    const turn = fenTurn(fen);
    const spec = levelSpec(level);
    const plan = humanizedPlan(spec.level, this.hasSkillLevel);

    if (plan) {
      const cap = clockCapMs(turn, clock);
      const go: GoParams = Number.isFinite(cap) ? { depth: plan.depth, movetime: cap } : { depth: plan.depth };
      const o = await this.enqueue({ fen, go, options: this.analysis(plan.multiPv) });
      const lines = linesOf(o);
      if (lines.length === 0) return bestOf(o);
      return pickMove(fen, lines, spec.level, this.rng, plan.budgetCp);
    }

    const movetime = engineMovetime(spec.level, turn, clock);
    const o = await this.enqueue({
      fen,
      go: { movetime },
      options: { [MULTIPV]: 1, [SKILL]: spec.skill ?? 20 },
    });
    const move = bestOf(o);
    if (spec.level >= NEVER_MATE_IN_1_FROM && (spec.skill ?? 20) < 20 && allowsMateIn1(fen, move)) {
      // A weakened skill move walks into mate in 1: ask full strength instead.
      const retry = await this.enqueue({
        fen,
        go: { movetime: Math.max(100, Math.min(movetime, 500)) },
        options: { [MULTIPV]: 1, [SKILL]: 20 },
      });
      const safe = retry.status === 'done' ? retry.bestmove : null;
      if (retry.status === 'aborted') throw new EngineAbortError();
      if (safe && !allowsMateIn1(fen, safe)) return safe;
    }
    return move;
  };
}

function linesOf(o: Outcome) {
  if (o.status === 'done') return o.collector.lines();
  if (o.status === 'failed') throw o.error;
  if (o.status === 'aborted') throw new EngineAbortError();
  throw new EngineAbortError('Engine search timed out');
}

function bestOf(o: Outcome): Uci {
  if (o.status !== 'done') {
    linesOf(o);
    throw new EngineAbortError();
  }
  if (!o.bestmove) throw new Error('No legal move in this position');
  return o.bestmove;
}
