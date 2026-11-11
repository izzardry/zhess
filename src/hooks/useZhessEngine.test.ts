import { act, renderHook } from '@testing-library/react';
import { setSharedEngine, sharedEngine, useZhessEngine } from './useZhessEngine';
import { FakeEngine } from '@/lib/engine/fake';
import { EngineDriver } from '@/lib/engine/driver';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

afterEach(() => setSharedEngine(null));

describe('useZhessEngine', () => {
  it('creates one lazy browser engine and shares it', () => {
    setSharedEngine(null);
    const a = sharedEngine();
    expect(a).toBeInstanceOf(EngineDriver);
    expect(sharedEngine()).toBe(a);
    expect(a.state).toBe('idle'); // no worker started
  });

  it('re-renders on state and progress changes; methods stay stable', async () => {
    const fake = new FakeEngine();
    setSharedEngine(fake);
    const { result } = renderHook(() => useZhessEngine());
    expect(result.current.state).toBe('idle');
    const first = result.current;
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.state).toBe('ready');
    expect(result.current.progress).toBe(1);
    expect(result.current).not.toBe(first);
    expect(result.current.bestMove).toBe(first.bestMove);
    expect(result.current.stop).toBe(first.stop);
  });

  it('two hook users share one engine', async () => {
    const fake = new FakeEngine();
    setSharedEngine(fake);
    const a = renderHook(() => useZhessEngine());
    const b = renderHook(() => useZhessEngine());
    let move = '';
    await act(async () => {
      move = await a.result.current.bestMove(START, 5);
    });
    expect(move).toBe('a2a3');
    expect(b.result.current.state).toBe('ready');
    await act(async () => {
      await b.result.current.evaluate(START, 4);
    });
    expect(fake.calls.map((c) => c.method)).toEqual(['bestMove', 'evaluate']);
    b.result.current.stop();
    expect(fake.stops).toBe(1);
  });

  it('accepts an explicit engine', async () => {
    const fake = new FakeEngine({ moves: { [START]: 'e2e4' } });
    const { result } = renderHook(() => useZhessEngine(fake));
    let m = '';
    await act(async () => {
      m = await result.current.bestMove(START, 1);
    });
    expect(m).toBe('e2e4');
    expect(result.current.multiPv).toBeTypeOf('function');
  });
});
