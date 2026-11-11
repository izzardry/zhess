import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import { defaultSeating, isTouchDevice, readSeating, useSeating } from './useSeating';

const media = (matches: Record<string, boolean>) => ({
  matchMedia: (q: string) => ({ matches: matches[q] ?? false }) as MediaQueryList,
});

const touch = media({ '(pointer: coarse) and (not (pointer: fine)) and (not (hover: hover))': true });
const mouse = media({ '(pointer: fine)': true, '(hover: hover)': true });

describe('seating defaults', () => {
  it('touch devices sit face to face, mouse devices side by side', () => {
    expect(isTouchDevice(touch)).toBe(true);
    expect(defaultSeating(touch)).toBe('face');
    expect(isTouchDevice(mouse)).toBe(false);
    expect(defaultSeating(mouse)).toBe('side');
  });

  it('falls back to the simple query when the combined one is not understood', () => {
    expect(isTouchDevice(media({ '(pointer: coarse)': true }))).toBe(true);
    expect(isTouchDevice(media({ '(pointer: coarse)': true, '(hover: hover)': true }))).toBe(false);
  });

  it('is side by side without matchMedia or when it throws', () => {
    expect(defaultSeating({} as Window)).toBe('side');
    expect(
      isTouchDevice({
        matchMedia: () => {
          throw new Error('no');
        },
      }),
    ).toBe(false);
  });

  it('a stored value wins over the default; junk is ignored', () => {
    expect(readSeating(createStore(memoryStorage({ 'zhess:seating': '"face"' })), mouse)).toBe('face');
    expect(readSeating(createStore(memoryStorage({ 'zhess:seating': 'side' })), touch)).toBe('side');
    expect(readSeating(createStore(memoryStorage({ 'zhess:seating': '"upside"' })), touch)).toBe('face');
    expect(readSeating(createStore(memoryStorage({ 'zhess:seating': '42' })), mouse)).toBe('side');
  });
});

describe('useSeating', () => {
  it('toggles and persists under zhess:seating', () => {
    const mem = memoryStorage({ 'zhess:seating': '"side"' });
    const store = createStore(mem);
    const { result } = renderHook(() => useSeating(store));
    expect(result.current.seating).toBe('side');
    act(() => result.current.toggleSeating());
    expect(result.current.seating).toBe('face');
    expect(mem.dump()['zhess:seating']).toBe('"face"');
    act(() => result.current.setSeating('side'));
    expect(result.current.seating).toBe('side');
    expect(store.pref('seating', '')).toBe('side');
  });

  it('uses the device default (jsdom: no touch) when nothing is stored', () => {
    const { result } = renderHook(() => useSeating(createStore(memoryStorage())));
    expect(result.current.seating).toBe('side');
  });
});
