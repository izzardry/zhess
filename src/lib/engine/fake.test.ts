import { FakeEngine, materialEval } from './fake';
import { isEngineAbort } from './driver';
import { legalUci } from '../levels';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Knight e3 can take the undefended queen on d5 (pawns keep it from being a material draw). */
const HANGING_Q = '4k3/7p/8/3q4/8/4N3/P7/4K3 w - - 0 1';
const BACK_RANK = '4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';

describe('materialEval', () => {
  it('scores material from the side to move', () => {
    expect(materialEval(START)).toEqual({ cp: 0 });
    expect(materialEval(HANGING_Q)).toEqual({ cp: -600 }); // N vs Q
    expect(materialEval(HANGING_Q.replace(' w ', ' b '))).toEqual({ cp: 600 });
  });
  it('knows mate, mate in one and draws', () => {
    const fool = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(materialEval(fool)).toEqual({ mate: 0 });
    expect(materialEval('4r1k1/5ppp/8/8/8/8/3R1PPP/6K1 b - - 0 1')).toEqual({ mate: 1 });
    expect(materialEval('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ cp: 0 }); // stalemate
    expect(materialEval('bad')).toEqual({ cp: 0 });
  });
});

describe('FakeEngine', () => {
  it('loads idle → loading → ready', async () => {
    const e = new FakeEngine();
    const seen: string[] = [];
    e.subscribe(() => seen.push(`${e.state}:${e.progress}`));
    expect(e.state).toBe('idle');
    await e.load();
    expect(seen).toEqual(['loading:0', 'loading:0.5', 'ready:1']);
    expect(e.calls).toEqual([{ method: 'load', args: [] }]);
  });

  it('honours loadMs with timers', async () => {
    vi.useFakeTimers();
    try {
      const e = new FakeEngine({ loadMs: 1000 });
      const p = e.load();
      expect(e.state).toBe('loading');
      await vi.advanceTimersByTimeAsync(500);
      expect(e.progress).toBe(0.5);
      await vi.advanceTimersByTimeAsync(500);
      await p;
      expect(e.state).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('can fail to load and recover', async () => {
    const e = new FakeEngine({ loadResult: 'fail' });
    await expect(e.load()).rejects.toThrow();
    expect(e.state).toBe('failed');
    await expect(e.bestMove(START, 1)).rejects.toThrow();
    await expect(e.evaluate(START, 8)).resolves.toBeNull();
    e.setLoadResult('ready');
    await expect(e.bestMove(START, 1)).resolves.toBe('a2a3');
    expect(e.state).toBe('ready');
  });

  it('bestMove: scripted (by FEN or first four fields, or a function), else the first legal move', async () => {
    const e = new FakeEngine({ moves: { [START.replace(' 0 1', ' 5 9')]: 'e2e4' } });
    await expect(e.bestMove(START, 5)).resolves.toBe('e2e4');
    await expect(e.bestMove(HANGING_Q, 5)).resolves.toBe(legalUci(HANGING_Q)[0]);
    const f = new FakeEngine({ moves: (fen, level) => (level === 12 ? 'g1f3' : undefined) });
    await expect(f.bestMove(START, 12)).resolves.toBe('g1f3');
    await expect(f.bestMove(START, 1, { wMs: 1, bMs: 2, incMs: 0 })).resolves.toBe('a2a3');
    expect(f.calls.at(-1)).toEqual({ method: 'bestMove', args: [START, 1, { wMs: 1, bMs: 2, incMs: 0 }] });
    await expect(f.bestMove('8/8/8/8/8/8/8/k6K w - - 0 1'.replace('k6K', 'k7') + '', 1)).rejects.toThrow();
  });

  it('evaluate: scripted evals (null = no answer), else material', async () => {
    const e = new FakeEngine({ evals: { [START]: { cp: 33 }, [BACK_RANK]: null } });
    await expect(e.evaluate(START, 8)).resolves.toEqual({ cp: 33 });
    await expect(e.evaluate(BACK_RANK, 8)).resolves.toBeNull();
    await expect(e.evaluate(HANGING_Q, 8)).resolves.toEqual({ cp: -600 });
    expect(e.calls.map((c) => c.method)).toEqual(['evaluate', 'evaluate', 'evaluate']);
  });

  it('evaluate times out when the search is slower than timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const e = new FakeEngine({ delayMs: 300 });
      const slow = e.evaluate(START, 8, 150);
      await vi.advanceTimersByTimeAsync(150);
      await expect(slow).resolves.toBeNull();
      const fast = e.evaluate(START, 8, 500);
      await vi.advanceTimersByTimeAsync(300);
      await expect(fast).resolves.toEqual({ cp: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('multiPv scores every move one ply deep, best first', async () => {
    const e = new FakeEngine();
    const r = await e.multiPv(HANGING_Q, 3, 4);
    expect(r[0]).toEqual({ uci: 'e3d5', eval: { cp: 300 } });
    expect(r).toHaveLength(3);
    // Moving into a mate in one scores as being mated.
    const b = await e.multiPv(BACK_RANK, 40, 2);
    expect(b.find((l) => l.uci === 'd1d7')?.eval).toEqual({ mate: -1 });
    expect(b.at(-1)?.eval.mate).toBe(-1);
  });

  it('stop() aborts pending searches', async () => {
    vi.useFakeTimers();
    try {
      const e = new FakeEngine({ delayMs: 1000 });
      const best = e.bestMove(START, 5);
      const mpv = e.multiPv(START, 2, 2);
      const ev = e.evaluate(START, 2);
      await vi.advanceTimersByTimeAsync(10);
      e.stop();
      await expect(best).rejects.toSatisfy(isEngineAbort);
      await expect(mpv).rejects.toSatisfy(isEngineAbort);
      await expect(ev).resolves.toBeNull();
      expect(e.stops).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose refuses further work', async () => {
    const e = new FakeEngine();
    await e.load();
    e.dispose();
    expect(e.state).toBe('idle');
    await expect(e.load()).rejects.toThrow();
  });
});
