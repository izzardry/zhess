import { EngineDriver, isEngineAbort, type PortHandlers, type UciPort } from './driver';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BACK_RANK = '4r1k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';

const STOCKFISH_OPTIONS = [
  'option name Threads type spin default 1 min 1 max 1',
  'option name Hash type spin default 16 min 1 max 33554432',
  'option name MultiPV type spin default 1 min 1 max 256',
  'option name Skill Level type spin default 20 min 0 max 20',
];

interface Go {
  fen: string;
  cmd: string;
  options: Record<string, string>;
}

/**
 * A scripted engine. The handshake is answered automatically (unless `manualHandshake`); a `go` is
 * answered by `respond` (lines delivered in a microtask) or held until `answer()` when `respond`
 * returns null.
 */
class Sim {
  sent: string[] = [];
  gos: Go[] = [];
  h!: PortHandlers;
  terminated = 0;
  ports = 0;
  private fen = '';
  private options: Record<string, string> = {};
  constructor(
    public opts: {
      options?: string[];
      manualHandshake?: boolean;
      respond?: (go: Go) => string[] | null;
      throwOnCreate?: boolean;
    } = {},
  ) {}

  factory = (h: PortHandlers): UciPort => {
    if (this.opts.throwOnCreate) throw new Error('no workers here');
    this.h = h;
    this.ports++;
    this.options = {};
    return {
      send: (cmd) => this.receive(cmd),
      terminate: () => {
        this.terminated++;
      },
    };
  };

  emit(...lines: string[]) {
    for (const l of lines) this.h.onLine(l);
  }

  private later(lines: string[]) {
    queueMicrotask(() => this.emit(...lines));
  }

  private receive(cmd: string) {
    this.sent.push(cmd);
    if (cmd === 'uci' && !this.opts.manualHandshake) {
      this.later(['id name Sim', ...(this.opts.options ?? STOCKFISH_OPTIONS), 'uciok']);
    } else if (cmd === 'isready' && !this.opts.manualHandshake) {
      this.later(['readyok']);
    } else if (cmd.startsWith('setoption name ')) {
      const m = /^setoption name (.+) value (.+)$/.exec(cmd);
      if (m) this.options[m[1]] = m[2];
    } else if (cmd.startsWith('position fen ')) {
      this.fen = cmd.slice('position fen '.length);
    } else if (cmd.startsWith('go')) {
      const go = { fen: this.fen, cmd, options: { ...this.options } };
      this.gos.push(go);
      const out = this.opts.respond?.(go) ?? null;
      if (out) this.later(out);
    }
  }

  /** Answer the held search. */
  answer(...lines: string[]) {
    this.emit(...lines);
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const defaultRespond = (go: Go) => [
  'info depth 1 multipv 1 score cp 10 pv e2e4',
  'info depth 1 multipv 2 score cp 5 pv d2d4',
  'bestmove e2e4',
];

describe('EngineDriver loading', () => {
  it('starts idle and does nothing until used', () => {
    const sim = new Sim();
    const d = new EngineDriver({ createPort: sim.factory });
    expect(d.state).toBe('idle');
    expect(d.progress).toBe(0);
    expect(sim.ports).toBe(0);
  });

  it('loads: uci handshake, options, isready, then ready with progress 1', async () => {
    const sim = new Sim();
    const d = new EngineDriver({ createPort: sim.factory });
    const states: string[] = [];
    d.subscribe(() => states.push(`${d.state}:${d.progress}`));
    const p = d.load();
    expect(d.state).toBe('loading');
    expect(d.load()).toBe(p); // one load at a time
    await p;
    expect(d.state).toBe('ready');
    expect(d.progress).toBe(1);
    expect(sim.sent.slice(0, 2)).toEqual(['uci', 'isready']);
    expect(d.hasSkillLevel).toBe(true);
    expect(d.engineOptions.get('MultiPV')?.max).toBe(256);
    expect(states[0]).toBe('loading:0');
    expect(states.at(-1)).toBe('ready:1');
    await d.load(); // resolves at once when ready
    expect(sim.ports).toBe(1);
  });

  it('reports download progress (scaled to 0.9) and keeps it monotonic', async () => {
    const sim = new Sim({ manualHandshake: true });
    const d = new EngineDriver({ createPort: sim.factory });
    const p = d.load();
    sim.h.onProgress(0.5);
    expect(d.progress).toBeCloseTo(0.45);
    sim.h.onProgress(0.2);
    expect(d.progress).toBeCloseTo(0.45);
    sim.h.onProgress(1);
    expect(d.progress).toBeCloseTo(0.9);
    sim.emit('uciok');
    expect(d.progress).toBeCloseTo(0.95);
    sim.emit('readyok');
    await p;
    expect(d.progress).toBe(1);
  });

  it('snapshots are immutable and change identity on every change', async () => {
    const sim = new Sim();
    const d = new EngineDriver({ createPort: sim.factory });
    const a = d.getSnapshot();
    expect(d.getSnapshot()).toBe(a);
    const p = d.load();
    const b = d.getSnapshot();
    expect(b).not.toBe(a);
    expect(Object.isFrozen(b)).toBe(true);
    await p;
  });

  it('fails on a worker error, rejects load, and retries on the next load', async () => {
    const sim = new Sim({ manualHandshake: true });
    const d = new EngineDriver({ createPort: sim.factory });
    const p = d.load();
    sim.h.onError(new Error('404'));
    await expect(p).rejects.toThrow('404');
    expect(d.state).toBe('failed');
    expect(d.progress).toBe(0);
    expect(sim.terminated).toBe(1);
    // Late lines of the dead port are ignored.
    const deadHandlers = sim.h;
    sim.opts.manualHandshake = false;
    const p2 = d.load();
    deadHandlers.onLine('uciok');
    await p2;
    expect(d.state).toBe('ready');
    expect(sim.ports).toBe(2);
  });

  it('fails when the port cannot be created', async () => {
    const d = new EngineDriver({ createPort: new Sim({ throwOnCreate: true }).factory });
    await expect(d.load()).rejects.toThrow('no workers here');
    expect(d.state).toBe('failed');
  });

  it('fails when the engine shows no sign of life within the init timeout', async () => {
    vi.useFakeTimers();
    try {
      const sim = new Sim({ manualHandshake: true });
      const d = new EngineDriver({ createPort: sim.factory, initTimeoutMs: 1000 });
      const p = d.load();
      const caught = p.catch((e: Error) => e);
      vi.advanceTimersByTime(900);
      sim.h.onProgress(0.3); // progress re-arms the timer
      vi.advanceTimersByTime(900);
      expect(d.state).toBe('loading');
      vi.advanceTimersByTime(200);
      expect(d.state).toBe('failed');
      expect(((await caught) as Error).name).toBe('EngineUnavailableError');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EngineDriver searches', () => {
  it('evaluate loads lazily and returns the score of line 1 from the side to move', async () => {
    const sim = new Sim({
      respond: () => ['info depth 1 score cp 12 pv e2e4', 'info depth 2 score cp -30 pv e2e4 e7e5', 'bestmove e2e4'],
    });
    const d = new EngineDriver({ createPort: sim.factory });
    await expect(d.evaluate(START, 2)).resolves.toEqual({ cp: -30 });
    expect(sim.gos[0].cmd).toBe('go depth 2');
    expect(sim.gos[0].fen).toBe(START);
    expect(sim.gos[0].options).toEqual({ MultiPV: '1', 'Skill Level': '20' });
  });

  it('evaluate of a mated position is mate 0; no score at all is null', async () => {
    const sim = new Sim({
      respond: (go) => (go.fen.startsWith('8') ? ['bestmove (none)'] : ['info depth 0 score mate 0', 'bestmove (none)']),
    });
    const d = new EngineDriver({ createPort: sim.factory });
    await expect(d.evaluate(START, 5)).resolves.toEqual({ mate: 0 });
    await expect(d.evaluate('8/8/8/8/8/8/8/K6k w - - 0 1', 5)).resolves.toBeNull();
  });

  it('multiPv returns n lines in order with evals', async () => {
    const sim = new Sim({
      respond: () => [
        'info depth 3 multipv 1 score cp 40 pv e2e4 e7e5',
        'info depth 3 multipv 2 score cp 30 pv d2d4',
        'info depth 3 multipv 3 score cp 20 pv g1f3',
        'bestmove e2e4',
      ],
    });
    const d = new EngineDriver({ createPort: sim.factory });
    const r = await d.multiPv(START, 2, 3);
    expect(r).toEqual([
      { uci: 'e2e4', eval: { cp: 40 } },
      { uci: 'd2d4', eval: { cp: 30 } },
    ]);
    expect(sim.gos[0].options.MultiPV).toBe('2');
  });

  it('runs one search at a time, in call order', async () => {
    const sim = new Sim(); // holds every go
    const d = new EngineDriver({ createPort: sim.factory });
    await d.load();
    const a = d.evaluate(START, 1);
    const b = d.multiPv(START, 3, 2);
    const c = d.evaluate(BACK_RANK, 4);
    await flush();
    expect(sim.gos).toHaveLength(1);
    sim.answer('info depth 1 score cp 1 pv e2e4', 'bestmove e2e4');
    await expect(a).resolves.toEqual({ cp: 1 });
    await flush();
    expect(sim.gos).toHaveLength(2);
    expect(sim.gos[1].cmd).toBe('go depth 2');
    sim.answer('info depth 2 multipv 1 score cp 2 pv d2d4', 'bestmove d2d4');
    await expect(b).resolves.toEqual([{ uci: 'd2d4', eval: { cp: 2 } }]);
    await flush();
    expect(sim.gos[2].fen).toBe(BACK_RANK);
    sim.answer('info depth 4 score cp 3 pv h2h3', 'bestmove h2h3');
    await expect(c).resolves.toEqual({ cp: 3 });
  });

  it('sets options only when they change and only when the engine offers them', async () => {
    const sim = new Sim({ options: ['option name MultiPV type spin default 1 min 1 max 4'], respond: defaultRespond });
    const d = new EngineDriver({ createPort: sim.factory });
    await d.evaluate(START, 1);
    await d.evaluate(START, 1);
    await d.multiPv(START, 9, 1);
    const setoptions = sim.sent.filter((c) => c.startsWith('setoption'));
    // No Skill Level (not offered); MultiPV clamped to the announced max of 4.
    expect(setoptions).toEqual(['setoption name MultiPV value 1', 'setoption name MultiPV value 4']);
  });

  it('evaluate resolves null on timeout: while queued (removed) and while running (stopped)', async () => {
    vi.useFakeTimers();
    try {
      const sim = new Sim();
      const d = new EngineDriver({ createPort: sim.factory });
      const loading = d.load();
      await vi.runAllTicks();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await loading;
      const running = d.evaluate(START, 20, 150);
      const queued = d.evaluate(BACK_RANK, 20, 100);
      await Promise.resolve();
      expect(sim.gos).toHaveLength(1);
      vi.advanceTimersByTime(100);
      await expect(queued).resolves.toBeNull();
      vi.advanceTimersByTime(50);
      await expect(running).resolves.toBeNull();
      expect(sim.sent.filter((c) => c === 'stop')).toHaveLength(1);
      // The engine answers the stopped search; only then does the next one start.
      const next = d.evaluate(START, 3);
      await Promise.resolve();
      expect(sim.gos).toHaveLength(1);
      sim.answer('info depth 9 score cp 99 pv e2e4', 'bestmove e2e4');
      await Promise.resolve();
      expect(sim.gos).toHaveLength(2);
      expect(sim.gos[1].fen).toBe(START);
      sim.answer('info depth 3 score cp 7 pv e2e4', 'bestmove e2e4');
      await expect(next).resolves.toEqual({ cp: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the evaluate timeout counts loading time too', async () => {
    vi.useFakeTimers();
    try {
      const sim = new Sim({ manualHandshake: true });
      const d = new EngineDriver({ createPort: sim.factory });
      const e = d.evaluate(START, 8, 150);
      expect(d.state).toBe('loading');
      vi.advanceTimersByTime(150);
      await expect(e).resolves.toBeNull();
      expect(sim.gos).toHaveLength(0);
      sim.emit('uciok', 'readyok');
      expect(d.state).toBe('ready');
      expect(sim.gos).toHaveLength(0); // the timed-out search never runs
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() cancels the running and queued searches', async () => {
    const sim = new Sim();
    const d = new EngineDriver({ createPort: sim.factory });
    await d.load();
    const best = d.bestMove(START, 8);
    const mpv = d.multiPv(START, 3, 5);
    const ev = d.evaluate(START, 5);
    await flush();
    expect(sim.gos).toHaveLength(1);
    d.stop();
    await expect(best).rejects.toSatisfy(isEngineAbort);
    await expect(mpv).rejects.toSatisfy(isEngineAbort);
    await expect(ev).resolves.toBeNull();
    expect(sim.sent.at(-1)).toBe('stop');
    sim.answer('bestmove e2e4');
    await flush();
    expect(sim.gos).toHaveLength(1); // the cancelled ones never ran
    d.stop(); // nothing running: no extra stop
    expect(sim.sent.filter((c) => c === 'stop')).toHaveLength(1);
  });

  it('a hung search is stopped by the watchdog, then the engine is failed and pending work settles', async () => {
    vi.useFakeTimers();
    try {
      const sim = new Sim();
      const d = new EngineDriver({ createPort: sim.factory, watchdogMs: 1000 });
      const loading = d.load();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await loading;
      const best = d.bestMove(START, 6); // movetime 300
      const caught = best.catch((e: Error) => e);
      const ev = d.evaluate(START, 3);
      for (let i = 0; i < 5; i++) await Promise.resolve();
      vi.advanceTimersByTime(1300);
      expect(sim.sent.at(-1)).toBe('stop');
      expect(d.state).toBe('ready');
      vi.advanceTimersByTime(3000);
      expect(d.state).toBe('failed');
      expect(((await caught) as Error).name).toBe('EngineUnavailableError');
      await expect(ev).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a worker crash mid-search fails the engine; the next call reloads', async () => {
    const sim = new Sim({ respond: defaultRespond });
    const d = new EngineDriver({ createPort: sim.factory });
    await d.load();
    sim.opts.respond = () => null;
    const mpv = d.multiPv(START, 2, 2);
    await flush();
    sim.h.onError(new Error('RuntimeError: unreachable'));
    await expect(mpv).rejects.toThrow('unreachable');
    expect(d.state).toBe('failed');
    sim.opts.respond = defaultRespond;
    await expect(d.evaluate(START, 1)).resolves.toEqual({ cp: 10 });
    expect(d.state).toBe('ready');
    expect(sim.ports).toBe(2);
  });

  it('dispose terminates and refuses further work', async () => {
    const sim = new Sim({ respond: defaultRespond });
    const d = new EngineDriver({ createPort: sim.factory });
    await d.load();
    d.dispose();
    expect(sim.terminated).toBe(1);
    expect(d.state).toBe('idle');
    await expect(d.load()).rejects.toThrow();
    await expect(d.evaluate(START, 1)).resolves.toBeNull();
    await expect(d.bestMove(START, 5)).rejects.toThrow();
  });
});

describe('EngineDriver.bestMove levels', () => {
  it('levels 1–4: MultiPV at the table depth, then the humanized picker with the injected rng', async () => {
    const sim = new Sim({
      respond: () => [
        'info depth 4 multipv 1 score cp 40 pv e2e4',
        'info depth 4 multipv 2 score cp 30 pv d2d4',
        'info depth 4 multipv 3 score cp -500 pv g2g4',
        'bestmove e2e4',
      ],
    });
    const d = new EngineDriver({ createPort: sim.factory, rng: () => 0.99 });
    // Level 1: budget 400 → e2e4 or d2d4 (g2g4 is 540 worse); rng 0.99 picks the last of those.
    await expect(d.bestMove(START, 1)).resolves.toBe('d2d4');
    expect(sim.gos[0].cmd).toBe('go depth 4');
    expect(sim.gos[0].options).toMatchObject({ MultiPV: '6', 'Skill Level': '20' });
    await d.bestMove(START, 4);
    expect(sim.gos[1].cmd).toBe('go depth 7');
    expect(sim.gos[1].options.MultiPV).toBe('3');
  });

  it('humanized levels cap their search by the clock in timed games', async () => {
    const sim = new Sim({ respond: defaultRespond });
    const d = new EngineDriver({ createPort: sim.factory, rng: () => 0 });
    await d.bestMove(START, 2, { wMs: 10_000, bMs: 60_000, incMs: 0 });
    expect(sim.gos[0].cmd).toBe('go depth 5 movetime 500');
  });

  it('levels 5–12: Skill Level and move time', async () => {
    const sim = new Sim({ respond: () => ['info depth 8 score cp 20 pv g1f3', 'bestmove g1f3'] });
    const d = new EngineDriver({ createPort: sim.factory });
    await expect(d.bestMove(START, 5)).resolves.toBe('g1f3');
    expect(sim.gos[0].cmd).toBe('go movetime 200');
    expect(sim.gos[0].options).toMatchObject({ MultiPV: '1', 'Skill Level': '3' });
    await d.bestMove(START, 12, { wMs: 600_000, bMs: 600_000, incMs: 0 });
    expect(sim.gos[1].cmd).toBe('go movetime 20000');
    expect(sim.gos[1].options['Skill Level']).toBe('20');
    await d.bestMove('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 11, {
      wMs: 600_000,
      bMs: 4_000,
      incMs: 0,
    });
    expect(sim.gos[2].cmd).toBe('go movetime 200'); // black's own clock: 4000/20
  });

  it('a skill move into mate in 1 is replaced by a full-strength search (level 3+)', async () => {
    const sim = new Sim({
      respond: (go) =>
        go.options['Skill Level'] === '20' ? ['bestmove h2h3'] : ['info depth 5 score cp 10 pv d1d7', 'bestmove d1d7'],
    });
    const d = new EngineDriver({ createPort: sim.factory });
    await expect(d.bestMove(BACK_RANK, 6)).resolves.toBe('h2h3');
    expect(sim.gos).toHaveLength(2);
    expect(sim.gos[1].cmd).toBe('go movetime 300');
  });

  it('without Skill Level, levels 5–11 are emulated with MultiPV and a budget', async () => {
    const sim = new Sim({
      options: ['option name MultiPV type spin default 1 min 1 max 256'],
      respond: () => [
        'info depth 8 multipv 1 score cp 50 pv e2e4',
        'info depth 8 multipv 2 score cp 0 pv d2d4',
        'bestmove e2e4',
      ],
    });
    const d = new EngineDriver({ createPort: sim.factory, rng: () => 0.99 });
    await expect(d.bestMove(START, 5)).resolves.toBe('d2d4'); // 50 cp worse, inside the 100 cp budget
    expect(sim.gos[0].cmd).toBe('go depth 8');
    await expect(d.bestMove(START, 11)).resolves.toBe('e2e4'); // budget 0
    await d.bestMove(START, 12);
    expect(sim.gos.at(-1)?.cmd).toBe('go movetime 3000');
  });

  it('rejects in a position without legal moves', async () => {
    const sim = new Sim({ respond: () => ['info depth 0 score mate 0', 'bestmove (none)'] });
    const d = new EngineDriver({ createPort: sim.factory });
    await expect(d.bestMove(START, 1)).rejects.toThrow('No legal move');
    await expect(d.bestMove(START, 8)).rejects.toThrow('No legal move');
  });
});
