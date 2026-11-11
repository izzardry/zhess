import { act, renderHook } from '@testing-library/react';
import { FakeEngine } from '@/lib/engine/fake';
import type { EngineApi, Game } from '@/lib/types';
import { newGame, play, START_FEN, undo } from '@/lib/zhess';
import { engineClock, playableMove, toTc, useComputer, useEngineStart, type UseComputerOptions } from './useComputer';

type Props = UseComputerOptions;

function setup(over: Partial<Props> & { engine: EngineApi }) {
  const onMove = vi.fn();
  const onFail = vi.fn();
  const initialProps: Props = {
    game: newGame(),
    enabled: true,
    computerColor: 'w',
    level: 5,
    onMove,
    onFail,
    now: () => Date.now(),
    ...over,
  };
  const hook = renderHook((p: Props) => useComputer(p), { initialProps });
  const rerender = (p: Partial<Props>) => hook.rerender({ ...initialProps, ...p });
  return { ...hook, onMove, onFail, initialProps, rerender };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useComputer', () => {
  it('moves first when the player is black, never before 400 ms', async () => {
    const engine = new FakeEngine({ moves: { [START_FEN]: 'e2e4' } });
    const { result, onMove } = setup({ engine });
    expect(result.current.thinking).toBe(true);
    await advance(399);
    expect(onMove).not.toHaveBeenCalled();
    expect(result.current.thinking).toBe(true);
    await advance(1);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('e2e4', 400);
    expect(result.current.thinking).toBe(false);
    expect(engine.calls.filter((c) => c.method === 'bestMove')).toEqual([
      { method: 'bestMove', args: [START_FEN, 5] },
    ]);
  });

  it('plays as soon as a slow search is done', async () => {
    const engine = new FakeEngine({ delayMs: 1200 });
    const { onMove } = setup({ engine });
    await advance(1199);
    expect(onMove).not.toHaveBeenCalled();
    await advance(1);
    expect(onMove).toHaveBeenCalledWith('a2a3', 1200);
  });

  it('reports the time from `elapsed` when given', async () => {
    const engine = new FakeEngine();
    const { onMove } = setup({ engine, elapsed: () => 777 });
    await advance(400);
    expect(onMove).toHaveBeenCalledWith('a2a3', 777);
  });

  it('waits for its turn and the next turn after the player moved', async () => {
    const engine = new FakeEngine();
    const g0 = newGame();
    const { onMove, rerender } = setup({ engine, game: g0, computerColor: 'b' });
    await advance(1000);
    expect(onMove).not.toHaveBeenCalled();
    expect(engine.calls).toEqual([]);
    rerender({ game: play(g0, 'e2e4', 0), computerColor: 'b' });
    await advance(400);
    expect(onMove).toHaveBeenCalledWith('b8c6', 400); // the fake's first legal move
  });

  it('does nothing when disabled, over, or without a game', async () => {
    const engine = new FakeEngine();
    const { onMove, rerender } = setup({ engine, enabled: false });
    await advance(1000);
    rerender({ enabled: true, game: null });
    await advance(1000);
    const over = { ...newGame(), end: { result: '0-1' as const, by: 'resign' as const } };
    rerender({ enabled: true, game: over });
    await advance(1000);
    expect(onMove).not.toHaveBeenCalled();
    expect(engine.calls).toEqual([]);
  });

  it('ignores a stale result after undo and stops the running search', async () => {
    const engine = new FakeEngine({ delayMs: 1000 });
    const g1 = play(play(newGame(), 'e2e4', 0), 'e7e5', 0); // computer (w) to move
    const { onMove, rerender } = setup({ engine, game: g1 });
    await advance(300);
    const back = undo(g1, 2); // computer to move again, at the start
    rerender({ game: back });
    expect(engine.stops).toBe(1);
    await advance(1000);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith('a2a3', 1000);
  });

  it('ignores the move when the player leaves during the minimum wait', async () => {
    const engine = new FakeEngine();
    const { onMove, rerender, result } = setup({ engine });
    await advance(100); // search done, waiting for 400 ms
    rerender({ enabled: false });
    expect(result.current.thinking).toBe(false);
    expect(engine.stops).toBe(0); // nothing was running any more
    await advance(1000);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('starts a fresh turn for a new session in the same position', async () => {
    const engine = new FakeEngine({ delayMs: 300 });
    const { onMove, rerender } = setup({ engine, sessionKey: 'A' });
    await advance(200);
    rerender({ sessionKey: 'B' });
    await advance(399);
    expect(onMove).not.toHaveBeenCalled();
    await advance(1);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('passes both clocks in timed games', async () => {
    const engine = new FakeEngine();
    const g = play(play(play(newGame(), 'e2e4', 1000), 'e7e5', 2000), 'g1f3', 3000);
    setup({ engine, game: g, computerColor: 'b', tc: '1+2' });
    await advance(400);
    // First moves are untimed; white's second move used 3000 and gained 2000.
    expect(engine.calls[0]).toEqual({
      method: 'bestMove',
      args: [g.fen, 5, { wMs: 59_000, bMs: 60_000, incMs: 2000 }],
    });
  });

  it('retries a search stopped by somebody else', async () => {
    const engine = new FakeEngine({ delayMs: 100 });
    const { onMove } = setup({ engine });
    await advance(50);
    act(() => engine.stop());
    await advance(349);
    expect(onMove).not.toHaveBeenCalled();
    await advance(1);
    expect(onMove).toHaveBeenCalledWith('a2a3', 400);
    expect(engine.calls.filter((c) => c.method === 'bestMove')).toHaveLength(2);
  });

  it('reports a failed engine once and retries on demand', async () => {
    const engine = new FakeEngine({ loadResult: 'fail' });
    const { onMove, onFail, result } = setup({ engine });
    await advance(10);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(result.current.failed).toBe(true);
    expect(result.current.thinking).toBe(false);
    engine.setLoadResult('ready');
    act(() => result.current.retry());
    expect(result.current.failed).toBe(false);
    await advance(400);
    expect(onMove).toHaveBeenCalledWith('a2a3', expect.any(Number));
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('replaces an illegal engine answer with a legal move', async () => {
    const engine = new FakeEngine({ moves: { [START_FEN]: 'e2e5' } });
    const { onMove } = setup({ engine });
    await advance(400);
    expect(onMove).toHaveBeenCalledWith('a2a3', 400);
  });

  it('ignores other search errors quietly', async () => {
    const engine: EngineApi = {
      ...new FakeEngine(),
      state: 'ready',
      progress: 1,
      load: () => Promise.resolve(),
      bestMove: () => Promise.reject(new Error('No legal move in this position')),
      evaluate: () => Promise.resolve(null),
      multiPv: () => Promise.resolve([]),
      stop: () => {},
    };
    const { onMove, onFail, result } = setup({ engine });
    await advance(1000);
    expect(onMove).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
    expect(result.current.thinking).toBe(false);
  });
});

describe('pure helpers', () => {
  it('toTc and engineClock', () => {
    expect(toTc(null)).toBeNull();
    expect(toTc('5+3')).toEqual({ baseMs: 300_000, incMs: 3000 });
    expect(toTc({ baseMs: 1, incMs: 2 })).toEqual({ baseMs: 1, incMs: 2 });
    expect(engineClock(newGame(), null)).toBeUndefined();
    expect(engineClock(newGame(), '3+0')).toEqual({ wMs: 180_000, bMs: 180_000, incMs: 0 });
    const over: Game = { ...newGame(), end: { result: '1-0', by: 'resign' } };
    expect(engineClock(over, '3+0')).toBeUndefined();
  });

  it('playableMove', () => {
    expect(playableMove(START_FEN, 'e2e4')).toBe('e2e4');
    expect(playableMove(START_FEN, 'E2E4')).toBe('e2e4');
    expect(playableMove(START_FEN, 'e2e5')).toBe('a2a3');
    expect(playableMove(START_FEN, null)).toBe('a2a3');
    expect(playableMove('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8')).toBe('a7a8q');
    expect(playableMove('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'h8g8')).toBeNull(); // stalemate
  });
});

describe('useEngineStart', () => {
  it('shows progress while loading and resolves true when ready', async () => {
    const engine = new FakeEngine({ loadMs: 200 });
    const { result, rerender } = renderHook(({ e }: { e: EngineApi }) => useEngineStart(e), {
      initialProps: { e: engine as EngineApi },
    });
    expect(result.current.loading).toBe(false);
    let done: Promise<boolean> = Promise.resolve(false);
    act(() => {
      done = result.current.prepare();
    });
    rerender({ e: snapshot(engine) });
    expect(result.current.loading).toBe(true);
    expect(result.current.progress).toBe(0);
    await advance(100);
    rerender({ e: snapshot(engine) });
    expect(result.current.progress).toBe(0.5);
    await advance(100);
    rerender({ e: snapshot(engine) });
    await expect(done).resolves.toBe(true);
    expect(result.current.loading).toBe(false);
    // Already ready: immediately true, no spinner.
    let again: Promise<boolean> = Promise.resolve(false);
    act(() => {
      again = result.current.prepare();
    });
    await expect(again).resolves.toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('resolves false and reports a failure', async () => {
    const engine = new FakeEngine({ loadResult: 'fail' });
    const onFail = vi.fn();
    const { result } = renderHook(() => useEngineStart(engine, { onFail }));
    let done: Promise<boolean> = Promise.resolve(true);
    act(() => {
      done = result.current.prepare();
    });
    await advance(1);
    await expect(done).resolves.toBe(false);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it('cancel makes a waiting prepare resolve false', async () => {
    const engine = new FakeEngine({ loadMs: 100 });
    const { result } = renderHook(() => useEngineStart(engine));
    let done: Promise<boolean> = Promise.resolve(true);
    act(() => {
      done = result.current.prepare();
    });
    act(() => result.current.cancel());
    expect(result.current.loading).toBe(false);
    await advance(100);
    await expect(done).resolves.toBe(false);
  });
});

/** A plain object view of the fake's current state (the hook reads `state` / `progress` per render). */
function snapshot(e: FakeEngine): EngineApi {
  return {
    state: e.state,
    progress: e.progress,
    load: e.load,
    bestMove: e.bestMove,
    evaluate: e.evaluate,
    multiPv: e.multiPv,
    stop: e.stop,
  };
}
