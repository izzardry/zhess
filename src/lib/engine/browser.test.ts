import { ENGINE_PATH, createBrowserEngine, createWorkerPort, engineUrl, type WorkerLike } from './browser';

class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  constructor(public url: string) {}
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class FakePort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe('engineUrl', () => {
  it('resolves next to the app under any base path (vite base "./")', () => {
    expect(engineUrl('https://izzardry.github.io/zhess/')).toBe(
      'https://izzardry.github.io/zhess/engine/stockfish-19-lite-single.js',
    );
    expect(engineUrl('https://izzardry.github.io/zhess/index.html')).toBe(
      'https://izzardry.github.io/zhess/engine/stockfish-19-lite-single.js',
    );
    expect(engineUrl('http://localhost:4173/')).toBe('http://localhost:4173/engine/stockfish-19-lite-single.js');
    expect(ENGINE_PATH).toBe('engine/stockfish-19-lite-single.js');
  });
  it('defaults to document.baseURI (the hash route does not matter)', () => {
    expect(engineUrl()).toBe(new URL(ENGINE_PATH, document.baseURI).href);
  });
});

describe('createWorkerPort', () => {
  function setup() {
    const workers: FakeWorker[] = [];
    const port1 = new FakePort();
    const port2 = new FakePort();
    const h = { onLine: vi.fn(), onError: vi.fn(), onProgress: vi.fn() };
    const port = createWorkerPort('https://x/engine/stockfish-19-lite-single.js', h, {
      createWorker: (u) => {
        const w = new FakeWorker(u);
        workers.push(w);
        return w;
      },
      createChannel: () => ({ port1, port2 }) as unknown as { port1: MessagePort; port2: MessagePort },
    });
    return { w: workers[0], port, h, port1, port2 };
  }

  it('starts the engine file as the worker and hands it the progress port first', () => {
    const { w, port2 } = setup();
    expect(w.url).toBe('https://x/engine/stockfish-19-lite-single.js');
    expect(w.posted[0]).toEqual({ progressPort: port2 });
  });

  it('sends commands and splits replies into lines', () => {
    const { w, port, h } = setup();
    port.send('uci');
    expect(w.posted.at(-1)).toBe('uci');
    w.reply('id name Stockfish\nuciok');
    w.reply({ not: 'a line' });
    expect(h.onLine.mock.calls.map((c) => c[0])).toEqual(['id name Stockfish', 'uciok']);
  });

  it('maps the engine download progress messages', () => {
    const { port1, h } = setup();
    port1.send({ percent: 0.25, loaded: 1, total: 4 });
    port1.send({ loaded: 3, total: 4 });
    port1.send({ junk: true });
    port1.send(null);
    expect(h.onProgress.mock.calls.map((c) => c[0])).toEqual([0.25, 0.75]);
  });

  it('reports worker errors (and keeps them out of the console)', () => {
    const { w, h } = setup();
    const preventDefault = vi.fn();
    w.onerror?.({ message: 'Failed to fetch', preventDefault } as unknown as ErrorEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(h.onError.mock.calls[0][0].message).toBe('Failed to fetch');
  });

  it('terminate stops the worker and silences it', () => {
    const { w, port, h, port1 } = setup();
    port.terminate();
    port.terminate();
    expect(w.terminated).toBe(true);
    expect(port1.closed).toBe(true);
    w.reply('bestmove e2e4');
    port.send('go depth 1');
    expect(h.onLine).not.toHaveBeenCalled();
    expect(w.posted.at(-1)).not.toBe('go depth 1');
  });

  it('works without MessageChannel', () => {
    const h = { onLine: vi.fn(), onError: vi.fn(), onProgress: vi.fn() };
    let w!: FakeWorker;
    createWorkerPort('u', h, {
      createWorker: (u) => (w = new FakeWorker(u)),
      createChannel: () => null,
    }).send('uci');
    expect(w.posted).toEqual(['uci']);
  });
});

describe('createBrowserEngine', () => {
  it('fails cleanly where Workers do not exist (jsdom)', async () => {
    const e = createBrowserEngine({ url: 'http://localhost/engine/stockfish-19-lite-single.js' });
    expect(e.state).toBe('idle');
    await expect(e.load()).rejects.toThrow();
    expect(e.state).toBe('failed');
  });
});
