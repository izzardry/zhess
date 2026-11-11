/**
 * Browser port: the Stockfish file itself runs as a classic Web Worker (DESIGN 10.1, PLAN 7).
 *
 * Why the engine file is the worker (and not a bundled `engine.worker.ts`): stockfish.js is a
 * self-contained worker script. It finds its `.wasm` next to itself (`location` of the worker with
 * `.js` → `.wasm`), so the only thing that has to be right is the worker URL. That URL is resolved
 * against `document.baseURI`, which works for any deployment path under Vite `base: "./"`
 * (`https://host/zhess/` → `https://host/zhess/engine/stockfish-19-lite-single.js`) and in dev
 * (`/engine/…` served from `public/`). Vite does not touch the files in `public/engine/`, so no
 * worker bundling question arises, and the service worker caches both files at runtime
 * (`engine-cache`, CacheFirst; see vite.config.ts).
 *
 * Download progress uses the engine's own hook: a `MessagePort` posted as `{ progressPort }`
 * receives `{ percent, loaded, total }` while the `.wasm` streams in.
 */
import { splitLines } from './uci.ts';
import { EngineDriver, type PortHandlers, type UciPort } from './driver.ts';

/** Path of the engine worker relative to the app's base URL. The `.wasm` sits next to it. */
export const ENGINE_PATH = 'engine/stockfish-19-lite-single.js';

/** Absolute URL of the engine worker, resolved against `document.baseURI` (or `base`). */
export function engineUrl(base?: string): string {
  const b = base ?? (typeof document !== 'undefined' ? document.baseURI : globalThis.location?.href);
  return new URL(ENGINE_PATH, b).href;
}

/** Minimal constructor shapes, injectable for tests. */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror?: ((ev: MessageEvent) => void) | null;
}

export interface WorkerPortDeps {
  createWorker?: (url: string) => WorkerLike;
  createChannel?: () => { port1: MessagePort; port2: MessagePort } | null;
}

/** A UCI port over a Worker running the engine file at `url`. */
export function createWorkerPort(url: string, h: PortHandlers, deps: WorkerPortDeps = {}): UciPort {
  const createWorker = deps.createWorker ?? ((u: string) => new Worker(u) as unknown as WorkerLike);
  const createChannel =
    deps.createChannel ?? (() => (typeof MessageChannel !== 'undefined' ? new MessageChannel() : null));

  const worker = createWorker(url);
  let closed = false;

  worker.onmessage = (ev: MessageEvent) => {
    if (closed) return;
    for (const line of splitLines(ev.data)) h.onLine(line);
  };
  worker.onerror = (ev: ErrorEvent) => {
    ev.preventDefault?.();
    if (closed) return;
    h.onError(new Error(ev.message || 'Engine worker error'));
  };
  worker.onmessageerror = () => {
    if (!closed) h.onError(new Error('Engine worker message error'));
  };

  const channel = createChannel();
  if (channel) {
    channel.port1.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { percent?: unknown; loaded?: unknown; total?: unknown } | null;
      if (closed || !d) return;
      const p =
        typeof d.percent === 'number'
          ? d.percent
          : typeof d.loaded === 'number' && typeof d.total === 'number' && d.total > 0
            ? d.loaded / d.total
            : NaN;
      if (Number.isFinite(p)) h.onProgress(p);
    };
    try {
      worker.postMessage({ progressPort: channel.port2 }, [channel.port2]);
    } catch {
      /* progress is optional */
    }
  }

  return {
    send(cmd: string) {
      if (!closed) worker.postMessage(cmd);
    },
    terminate() {
      if (closed) return;
      closed = true;
      try {
        channel?.port1.close();
      } catch {
        /* ignore */
      }
      worker.terminate();
    },
  };
}

/** An engine driver over the Web Worker (the app's engine; see `hooks/useZhessEngine`). */
export function createBrowserEngine(opts: { url?: string; rng?: () => number } = {}): EngineDriver {
  return new EngineDriver({
    createPort: (h) => createWorkerPort(opts.url ?? engineUrl(), h),
    rng: opts.rng,
  });
}
