import { act, renderHook } from '@testing-library/react';
import { FakeEngine } from '@/lib/engine/fake';
import type { EngineApi, Game } from '@/lib/types';
import { newGame, play, START_FEN } from '@/lib/zhess';
import { HINT_DEPTH, threatSquares, useHint, type UseHintOptions } from './useHint';

/** White Qd1, Kh1 vs Ke8, pawn d4: the fake's one-ply material search picks Qxd4. */
const WIN_PAWN = '4k3/8/8/8/3p4/8/8/3Q3K w - - 0 1';

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setup(engine: EngineApi, over: Partial<UseHintOptions> = {}) {
  const onAssisted = vi.fn();
  const onFail = vi.fn();
  const initialProps: UseHintOptions = { engine, game: newGame(WIN_PAWN), enabled: true, onAssisted, onFail, ...over };
  const hook = renderHook((p: UseHintOptions) => useHint(p), { initialProps });
  return {
    ...hook,
    onAssisted,
    onFail,
    rerender: (p: Partial<UseHintOptions>) => hook.rerender({ ...initialProps, ...p }),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useHint', () => {
  it('tap 1 pulses the from-square, tap 2 the target, then they alternate', async () => {
    const engine = new FakeEngine();
    const h = setup(engine);
    expect(h.result.current.step).toBe(0);
    expect(h.result.current.squares).toBeUndefined();

    act(() => h.result.current.tap());
    expect(h.result.current.pending).toBe(true);
    await flush();
    expect(h.result.current.pending).toBe(false);
    expect(h.result.current.move).toBe('d1d4');
    expect(h.result.current.step).toBe(1);
    expect(h.result.current.squares).toEqual(['d1']);
    expect(h.onAssisted).toHaveBeenCalledTimes(1);
    expect(engine.calls).toEqual([{ method: 'multiPv', args: [WIN_PAWN, 1, HINT_DEPTH] }]);

    act(() => h.result.current.tap());
    expect(h.result.current.step).toBe(2);
    expect(h.result.current.squares).toEqual(['d4']);

    const prev = h.result.current.squares;
    act(() => h.result.current.tap());
    expect(h.result.current.step).toBe(1);
    expect(h.result.current.squares).toEqual(['d1']);
    act(() => h.result.current.tap());
    expect(h.result.current.squares).toEqual(['d4']);
    expect(h.result.current.squares).not.toBe(prev); // a new array replays the pulse
    expect(engine.calls).toHaveLength(1);
    expect(h.onAssisted).toHaveBeenCalledTimes(1);
  });

  it('resets after a move', async () => {
    const engine = new FakeEngine();
    const h = setup(engine);
    act(() => h.result.current.tap());
    await flush();
    expect(h.result.current.step).toBe(1);
    const next = play(newGame(WIN_PAWN), 'd1d4', 0);
    h.rerender({ game: next });
    expect(h.result.current.step).toBe(0);
    expect(h.result.current.squares).toBeUndefined();
    act(() => h.result.current.tap());
    await flush();
    expect(h.result.current.step).toBe(1);
    expect(engine.calls.map((c) => c.args[0])).toEqual([WIN_PAWN, next.fen]);
  });

  it('ignores an answer for an old position', async () => {
    const engine = new FakeEngine({ delayMs: 100 });
    const h = setup(engine);
    act(() => h.result.current.tap());
    h.rerender({ game: play(newGame(WIN_PAWN), 'd1d2', 0) });
    await flush(200);
    expect(h.result.current.step).toBe(0);
    expect(h.result.current.pending).toBe(false);
    expect(h.onAssisted).not.toHaveBeenCalled();
  });

  it('ignores taps while waiting, disabled, without a game or when over', async () => {
    const engine = new FakeEngine({ delayMs: 100 });
    const h = setup(engine);
    act(() => h.result.current.tap());
    act(() => h.result.current.tap());
    await flush(100);
    expect(engine.calls).toHaveLength(1);

    const off = new FakeEngine();
    const d = setup(off, { enabled: false });
    act(() => d.result.current.tap());
    d.rerender({ enabled: true, game: null });
    act(() => d.result.current.tap());
    const over: Game = { ...newGame(), end: { result: '1-0', by: 'resign' } };
    d.rerender({ enabled: true, game: over });
    act(() => d.result.current.tap());
    await flush();
    expect(off.calls).toEqual([]);
    expect(d.result.current.step).toBe(0);
  });

  it('reports an unavailable engine, but not a cancelled search', async () => {
    const failing = new FakeEngine({ loadResult: 'fail' });
    const h = setup(failing);
    act(() => h.result.current.tap());
    await flush();
    expect(h.onFail).toHaveBeenCalledTimes(1);
    expect(h.result.current.pending).toBe(false);

    const slow = new FakeEngine({ delayMs: 100 });
    const s = setup(slow);
    act(() => s.result.current.tap());
    act(() => slow.stop());
    await flush(100);
    expect(s.onFail).not.toHaveBeenCalled();
    expect(s.result.current.pending).toBe(false);
    // Tapping again asks again.
    act(() => s.result.current.tap());
    await flush(100);
    expect(s.result.current.step).toBe(1);
  });

  it('reset() forgets the hint', async () => {
    const h = setup(new FakeEngine());
    act(() => h.result.current.tap());
    await flush();
    act(() => h.result.current.reset());
    expect(h.result.current.step).toBe(0);
    expect(h.result.current.move).toBeNull();
  });

  it('works for black in pass-and-play', async () => {
    const g = play(newGame(), 'e2e4', 0);
    const engine = new FakeEngine({ moves: {} });
    const h = setup(engine, { game: g });
    act(() => h.result.current.tap());
    await flush();
    expect(h.result.current.squares?.[0]?.[1]).toMatch(/[78]/); // a black piece
  });
});

describe('threatSquares', () => {
  it('lists the squares the opponent attacks', () => {
    const g = newGame(START_FEN);
    const w = threatSquares(g, 'w');
    expect(w).toContain('e6'); // black pawns cover the 6th rank
    expect(w).not.toContain('e4');
    expect(threatSquares(g, 'b')).toContain('e3');
  });
});
