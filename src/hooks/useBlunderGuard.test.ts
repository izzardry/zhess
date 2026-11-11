import { act, renderHook } from '@testing-library/react';
import { FakeEngine } from '@/lib/engine/fake';
import { BEFORE_TIMEOUT_MS, CONFIRM_WINDOW_MS, GUARD_DEPTH } from '@/lib/blunder';
import type { EngineApi, Game } from '@/lib/types';
import { newGame, play } from '@/lib/zhess';
import { useBlunderGuard, type BlunderCheck, type UseBlunderGuardOptions } from './useBlunderGuard';

/** White: Qd1, Kh1. Black: Ke8, pawns d4 and c3. Qd2?? hangs the queen; Qxd4 wins a pawn. */
const HANG = '4k3/8/8/8/3p4/2p5/8/3Q3K w - - 0 1';
const AFTER_QD2 = play(newGame(HANG), 'd1d2', 0).fen;
const AFTER_QD3 = play(newGame(HANG), 'd1d3', 0).fen;
/** Fool's mate: black to move, Qh4#. */
const MATING = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';

const evals = {
  [HANG]: { cp: 100 },
  [AFTER_QD2]: { cp: 800 }, // black's view: up a queen for a pawn
  [AFTER_QD3]: { cp: -100 },
};

let t = 0;
const now = () => t;

async function advance(ms: number) {
  t += ms;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function ready(engine: FakeEngine) {
  await act(async () => {
    await engine.load();
  });
}

function setup(engine: EngineApi, over: Partial<UseBlunderGuardOptions> = {}) {
  const initialProps: UseBlunderGuardOptions = {
    engine,
    game: newGame(HANG),
    enabled: true,
    playerColor: 'w',
    now,
    ...over,
  };
  const hook = renderHook((p: UseBlunderGuardOptions) => useBlunderGuard(p), { initialProps });
  return { ...hook, rerender: (p: Partial<UseBlunderGuardOptions>) => hook.rerender({ ...initialProps, ...p }) };
}

/** Runs `check` and lets timers and promises settle for up to `ms`. */
async function check(hook: { result: { current: { check(u: string): Promise<BlunderCheck> } } }, uci: string, ms = 200) {
  let out: BlunderCheck | undefined;
  let p!: Promise<BlunderCheck>;
  act(() => {
    p = hook.result.current.check(uci);
  });
  void p.then((r) => (out = r));
  await advance(ms);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  t = 1000;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useBlunderGuard', () => {
  it('starts the "before" evaluation when the player\'s turn begins', async () => {
    const engine = new FakeEngine({ evals });
    setup(engine);
    expect(engine.calls).toEqual([{ method: 'evaluate', args: [HANG, GUARD_DEPTH, BEFORE_TIMEOUT_MS] }]);
  });

  it('refuses a blunder once, pulses its square, and commits the repeat within 5 s', async () => {
    const engine = new FakeEngine({ evals });
    await ready(engine);
    const hook = setup(engine);
    expect(hook.result.current.active).toBe(true);
    await advance(10);

    expect(await check(hook, 'd1d2')).toEqual({ action: 'refuse', square: 'd1', reason: 'drop' });
    expect(hook.result.current.blunder).toBe('d1');
    expect(hook.result.current.blunderKey).toBe(1);
    expect(hook.result.current.checking).toBeNull();
    // Only the "after" search ran at drop time: the "before" one was reused.
    expect(engine.calls.filter((c) => c.method === 'evaluate').map((c) => c.args[0])).toEqual([HANG, AFTER_QD2]);

    await advance(CONFIRM_WINDOW_MS - 300);
    expect(await check(hook, 'd1d2', 0)).toEqual({ action: 'commit' });
  });

  it('checks again after the 5-second window, and pulses again', async () => {
    const engine = new FakeEngine({ evals });
    await ready(engine);
    const hook = setup(engine);
    expect((await check(hook, 'd1d2'))?.action).toBe('refuse');
    await advance(CONFIRM_WINDOW_MS + 1);
    expect((await check(hook, 'd1d2'))?.action).toBe('refuse');
    expect(hook.result.current.blunderKey).toBe(2);
    // Confirmation consumed: the next repeat within 5 s commits, the one after is checked again.
    expect(await check(hook, 'd1d2', 0)).toEqual({ action: 'commit' });
    expect((await check(hook, 'd1d2'))?.action).toBe('refuse');
  });

  it('commits good moves', async () => {
    const engine = new FakeEngine({ evals });
    await ready(engine);
    const hook = setup(engine);
    expect(await check(hook, 'd1d3')).toEqual({ action: 'commit' });
    expect(hook.result.current.blunder).toBeNull();
  });

  it('lets the move through when the engine is late (150 ms budget)', async () => {
    const engine = new FakeEngine({ evals, delayMs: 400 });
    await ready(engine);
    const hook = setup(engine);
    let out: BlunderCheck | undefined;
    act(() => {
      void hook.result.current.check('d1d2').then((r) => (out = r));
    });
    expect(hook.result.current.checking).toBe('d1d2');
    await advance(149);
    expect(out).toBeUndefined();
    await advance(1);
    expect(out).toEqual({ action: 'commit' });
    expect(hook.result.current.checking).toBeNull();
  });

  it('uses the chess.js fallback while the engine is not ready', async () => {
    const engine = new FakeEngine({ loadResult: 'fail' });
    const hook = setup(engine);
    await advance(10);
    expect(engine.state).toBe('failed');
    hook.rerender({ engine: { ...asApi(engine), state: 'failed' } });
    expect(await check(hook, 'd1d2', 0)).toEqual({ action: 'refuse', square: 'd1', reason: 'hanging' });
    expect(await check(hook, 'd1d3', 0)).toEqual({ action: 'commit' });
  });

  it('flags a move that allows a quick mate (engine)', async () => {
    const fool = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';
    const engine = new FakeEngine(); // material eval: mate in 1 for black after g4
    await ready(engine);
    const hook = setup(engine, { game: newGame(fool) });
    expect(await check(hook, 'g2g4')).toEqual({ action: 'refuse', square: 'g2', reason: 'mate' });
  });

  it('commits a mating move without asking the engine', async () => {
    const engine = new FakeEngine();
    await ready(engine);
    const hook = setup(engine, { game: newGame(MATING), playerColor: 'b' });
    const before = engine.calls.length;
    expect(await check(hook, 'd8h4', 0)).toEqual({ action: 'commit' });
    expect(engine.calls.length).toBe(before);
  });

  it('is off when disabled, not the player\'s turn, over, or for illegal input', async () => {
    const engine = new FakeEngine({ evals });
    await ready(engine);
    const hook = setup(engine, { enabled: false });
    expect(hook.result.current.active).toBe(false);
    expect(await check(hook, 'd1d2', 0)).toEqual({ action: 'commit' });
    expect(engine.calls.filter((c) => c.method === 'evaluate')).toEqual([]);

    hook.rerender({ enabled: true, playerColor: 'b' });
    expect(hook.result.current.active).toBe(false);
    expect(await check(hook, 'd1d2', 0)).toEqual({ action: 'commit' });

    const over: Game = { ...newGame(HANG), end: { result: '0-1', by: 'resign' } };
    hook.rerender({ game: over });
    expect(await check(hook, 'd1d2', 0)).toEqual({ action: 'commit' });

    hook.rerender({});
    expect(await check(hook, 'd1h8', 0)).toEqual({ action: 'commit' });
  });

  it('answers stale when the position changed during the check', async () => {
    const engine = new FakeEngine({ evals, delayMs: 100 });
    await ready(engine);
    const hook = setup(engine);
    let out: BlunderCheck | undefined;
    act(() => {
      void hook.result.current.check('d1d2').then((r) => (out = r));
    });
    hook.rerender({ game: play(newGame(HANG), 'd1d3', 0) });
    await advance(200);
    expect(out).toEqual({ action: 'stale' });
    expect(hook.result.current.blunder).toBeNull();
  });

  it('a newer check makes the older one stale', async () => {
    const engine = new FakeEngine({ evals, delayMs: 40 });
    await ready(engine);
    const hook = setup(engine);
    await advance(100); // the "before" evaluation is done
    const outs: BlunderCheck[] = [];
    act(() => {
      void hook.result.current.check('d1d2').then((r) => outs.push(r));
      void hook.result.current.check('d1d3').then((r) => outs.push(r));
    });
    await advance(200);
    expect(outs).toContainEqual({ action: 'stale' });
    expect(outs).toContainEqual({ action: 'commit' });
  });

  it('forgets the pulse when the position changes, and clear() forgets the refusal', async () => {
    const engine = new FakeEngine({ evals });
    await ready(engine);
    const hook = setup(engine);
    expect((await check(hook, 'd1d2'))?.action).toBe('refuse');
    act(() => hook.result.current.clear());
    expect(hook.result.current.blunder).toBeNull();
    expect((await check(hook, 'd1d2'))?.action).toBe('refuse'); // no confirmation after clear()
    hook.rerender({ game: play(newGame(HANG), 'd1d3', 0), playerColor: 'w' });
    expect(hook.result.current.blunder).toBeNull();
    expect(hook.result.current.blunderKey).toBe(2);
  });

  it('re-asks the "before" evaluation within the budget when it came back empty', async () => {
    const engine = new FakeEngine({ evals: { ...evals, [HANG]: null } });
    await ready(engine);
    const hook = setup(engine);
    await advance(10);
    // before = null → judged on "after" alone (no mate) → commit; but "before" was asked twice.
    expect(await check(hook, 'd1d2')).toEqual({ action: 'commit' });
    expect(engine.calls.filter((c) => c.method === 'evaluate').map((c) => c.args[0])).toEqual([HANG, HANG, AFTER_QD2]);
  });
});

function asApi(e: FakeEngine): EngineApi {
  return { state: e.state, progress: e.progress, load: e.load, bestMove: e.bestMove, evaluate: e.evaluate, multiPv: e.multiPv, stop: e.stop };
}
