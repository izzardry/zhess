import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import { readClock, readColor, readOpponent, useStartPrefs } from './useStartPrefs';

const setup = (initial: Record<string, string> = {}) => {
  const mem = memoryStorage(initial);
  return { mem, store: createStore(mem) };
};

describe('useStartPrefs', () => {
  it('uses the first-run defaults: COMPUTER 5, random, clock off', () => {
    const { store } = setup();
    const { result } = renderHook(() => useStartPrefs(store));
    expect(result.current.opponent).toEqual({ mode: 'computer', level: 5 });
    expect(result.current.color).toBe('random');
    expect(result.current.clock).toBeNull();
  });

  it('persists every change under zhess:opponent, zhess:color and zhess:clock', () => {
    const { store, mem } = setup();
    const { result } = renderHook(() => useStartPrefs(store));
    act(() => result.current.setOpponent({ mode: 'room' }));
    act(() => result.current.setColor('b'));
    act(() => result.current.setClock({ baseMs: 180000, incMs: 2000 }));
    expect(result.current.opponent).toEqual({ mode: 'room' });
    expect(result.current.color).toBe('b');
    expect(result.current.clock).toEqual({ baseMs: 180000, incMs: 2000 });
    expect(mem.dump()).toMatchObject({
      'zhess:opponent': '{"mode":"room"}',
      'zhess:color': '"b"',
      'zhess:clock': '"3+2"',
    });
    act(() => result.current.setClock(null));
    expect(mem.dump()['zhess:clock']).toBe('"off"');
  });

  it('restores remembered values', () => {
    const { store } = setup({
      'zhess:opponent': '{"mode":"computer","level":11}',
      'zhess:color': '"w"',
      'zhess:clock': '"15+10"',
    });
    const { result } = renderHook(() => useStartPrefs(store));
    expect(result.current.opponent).toEqual({ mode: 'computer', level: 11 });
    expect(result.current.color).toBe('w');
    expect(result.current.clock).toEqual({ baseMs: 900000, incMs: 10000 });
  });

  it('falls back to defaults on corrupt or foreign values', () => {
    const { store } = setup({
      'zhess:opponent': '{"mode":"computer","level":99}',
      'zhess:color': '"purple"',
      'zhess:clock': '{bad json',
    });
    expect(readOpponent(store)).toEqual({ mode: 'computer', level: 5 });
    expect(readColor(store)).toBe('random');
    expect(readClock(store)).toBeNull();
  });

  it('ignores invalid values passed to the setters', () => {
    const { store, mem } = setup();
    const { result } = renderHook(() => useStartPrefs(store));
    // @ts-expect-error runtime guard
    act(() => result.current.setColor('green'));
    expect(result.current.color).toBe('random');
    expect(mem.dump()['zhess:color']).toBeUndefined();
  });
});
