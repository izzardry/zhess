/**
 * Offline copy of the engine (DESIGN 14). The app downloads the Stockfish worker and its wasm
 * into `engine-cache` on its first launch, with progress, instead of waiting for the first
 * computer game. The service worker's CacheFirst route for `engine/*.js|wasm` (vite.config.ts)
 * then answers the worker's requests from that cache, also offline.
 *
 * The page downloads the files itself rather than through the precache, because a page cannot
 * see the progress of a service worker install. Each launch checks the cache again, so a copy
 * that iOS evicted is downloaded again on the next online launch.
 */
import { ENGINE_PATH } from './browser.ts';

/** Runtime cache shared with the service worker route in vite.config.ts. */
export const ENGINE_CACHE = 'engine-cache';
export const ENGINE_WASM_PATH = ENGINE_PATH.replace(/\.js$/, '.wasm');

/** Sizes of the shipped files, for progress when the server sends no usable Content-Length. */
const KNOWN_BYTES: Record<string, number> = { [ENGINE_PATH]: 28_230, [ENGINE_WASM_PATH]: 1_845_971 };
const FILES = [ENGINE_PATH, ENGINE_WASM_PATH] as const;

export type EngineOfflineStatus =
  /** No Cache Storage or service worker: nothing to show. */
  | { readonly status: 'unsupported' }
  | { readonly status: 'checking' }
  | { readonly status: 'downloading'; readonly percent: number }
  | { readonly status: 'ready' }
  /** Not cached. `offline`: waits for a connection; `failed`: tap to retry; `saveData`: tap to download. */
  | { readonly status: 'missing'; readonly reason: 'offline' | 'failed' | 'saveData' };

export interface EngineOfflineDeps {
  caches?: CacheStorage;
  fetch?: typeof fetch;
}

function urls(base: string): string[] {
  return FILES.map((p) => new URL(p, base).href);
}

/** Both engine files are in `engine-cache`. */
export async function isEngineCached(base: string, deps: EngineOfflineDeps = {}): Promise<boolean> {
  const store = deps.caches ?? globalThis.caches;
  if (!store) return false;
  const cache = await store.open(ENGINE_CACHE);
  const hits = await Promise.all(urls(base).map((u) => cache.match(u)));
  return hits.every(Boolean);
}

/**
 * Downloads both files into `engine-cache`, reporting 0–100. Rejects on a network error, a non-200
 * response or an abort; nothing partial is stored.
 */
export async function downloadEngine(
  base: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  deps: EngineOfflineDeps = {},
): Promise<void> {
  const store = deps.caches ?? globalThis.caches;
  const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const list = urls(base);
  const sizes = FILES.map((p) => KNOWN_BYTES[p]);
  const loaded = FILES.map(() => 0);
  const report = () => {
    const total = sizes.reduce((a, b) => a + b, 0);
    const done = loaded.reduce((a, b) => a + b, 0);
    onProgress(Math.min(99, Math.floor((done / total) * 100)));
  };
  report();

  const bodies = await Promise.all(
    list.map(async (url, i) => {
      const res = await doFetch(url, { signal, cache: 'no-cache' });
      if (res.status !== 200) throw new Error(`engine download: ${res.status} for ${url}`);
      // Content-Length counts the compressed bytes when the response is encoded; the stream
      // yields decoded bytes, so only trust it for unencoded responses.
      const length = Number(res.headers.get('content-length'));
      if (length > 0 && !res.headers.get('content-encoding')) sizes[i] = length;
      const type = res.headers.get('content-type') ?? (url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      const chunks: Uint8Array[] = [];
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded[i] += value.byteLength;
          sizes[i] = Math.max(sizes[i], loaded[i]);
          report();
        }
      } else {
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        loaded[i] = sizes[i] = buf.byteLength;
        report();
      }
      const body = new Uint8Array(loaded[i]);
      let at = 0;
      for (const c of chunks) {
        body.set(c, at);
        at += c.byteLength;
      }
      return { url, type, body };
    }),
  );

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const cache = await store.open(ENGINE_CACHE);
  // Only the content type is kept: the body is already decoded, so an encoding header would lie.
  await Promise.all(bodies.map((b) => cache.put(b.url, new Response(b.body, { status: 200, headers: { 'content-type': b.type } }))));
  onProgress(100);
}
