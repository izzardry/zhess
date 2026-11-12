import { describe, expect, it } from 'vitest';
import { ENGINE_PATH } from './browser';
import { ENGINE_CACHE, ENGINE_WASM_PATH, downloadEngine, isEngineCached } from './offline';

const BASE = 'https://example.test/zhess/';
const JS_URL = BASE + ENGINE_PATH;
const WASM_URL = BASE + ENGINE_WASM_PATH;

/** In-memory Cache Storage with the few methods the module uses. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (url: string) => m.get(url),
      put: async (url: string, res: Response) => void m.set(url, res),
    } as unknown as Cache;
  };
  return { stores, caches: { open } as unknown as CacheStorage };
}

function streamOf(bytes: number, chunk = 100_000): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= bytes) return c.close();
      const n = Math.min(chunk, bytes - sent);
      sent += n;
      c.enqueue(new Uint8Array(n));
    },
  });
}

function fakeFetch(opts: { status?: number; encoded?: boolean; sizes?: Record<string, number> } = {}) {
  const sizes = opts.sizes ?? { [JS_URL]: 30_000, [WASM_URL]: 900_000 };
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    const headers: Record<string, string> = {
      'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
    };
    if (opts.encoded) headers['content-encoding'] = 'gzip';
    headers['content-length'] = String(opts.encoded ? Math.round(sizes[url] / 3) : sizes[url]);
    return new Response(streamOf(sizes[url]), { status: opts.status ?? 200, headers });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('engine offline copy', () => {
  it('downloads both files into engine-cache with rising progress that ends at 100', async () => {
    const { stores, caches } = fakeCaches();
    const { fetch, calls } = fakeFetch();
    const seen: number[] = [];
    expect(await isEngineCached(BASE, { caches })).toBe(false);
    await downloadEngine(BASE, (p) => seen.push(p), undefined, { caches, fetch });
    expect(calls.sort()).toEqual([JS_URL, WASM_URL].sort());
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(100);
    expect(seen.slice(0, -1).every((p) => p <= 99)).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(await isEngineCached(BASE, { caches })).toBe(true);
    const wasm = stores.get(ENGINE_CACHE)!.get(WASM_URL)!;
    expect(wasm.headers.get('content-type')).toBe('application/wasm');
    expect(wasm.headers.get('content-encoding')).toBeNull();
    expect((await wasm.arrayBuffer()).byteLength).toBe(900_000);
  });

  it('never reports past 99 before the end when Content-Length counts compressed bytes', async () => {
    const { caches } = fakeCaches();
    const { fetch } = fakeFetch({ encoded: true });
    const seen: number[] = [];
    await downloadEngine(BASE, (p) => seen.push(p), undefined, { caches, fetch });
    expect(Math.max(...seen.slice(0, -1))).toBeLessThanOrEqual(99);
    expect(seen.at(-1)).toBe(100);
  });

  it('stores nothing when a file fails', async () => {
    const { caches } = fakeCaches();
    const { fetch } = fakeFetch({ status: 404 });
    await expect(downloadEngine(BASE, () => {}, undefined, { caches, fetch })).rejects.toThrow(/404/);
    expect(await isEngineCached(BASE, { caches })).toBe(false);
  });

  it('a copy with only one of the two files does not count', async () => {
    const { caches } = fakeCaches();
    await (await caches.open(ENGINE_CACHE)).put(JS_URL, new Response('x'));
    expect(await isEngineCached(BASE, { caches })).toBe(false);
  });
});
