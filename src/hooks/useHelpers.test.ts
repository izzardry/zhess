import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import { readHelpers, useHelpers } from './useHelpers';

describe('useHelpers', () => {
  it('is on by default', () => {
    expect(readHelpers(createStore(memoryStorage()))).toBe(true);
    const { result } = renderHook(() => useHelpers(createStore(memoryStorage())));
    expect(result.current.helpers).toBe(true);
  });

  it("reads 'true' / 'false' and treats junk as missing", () => {
    expect(readHelpers(createStore(memoryStorage({ 'zhess:helpers': 'false' })))).toBe(false);
    expect(readHelpers(createStore(memoryStorage({ 'zhess:helpers': 'true' })))).toBe(true);
    expect(readHelpers(createStore(memoryStorage({ 'zhess:helpers': '"nope"' })))).toBe(true);
    expect(readHelpers(createStore(memoryStorage({ 'zhess:helpers': '{bad' })))).toBe(true);
  });

  it('toggles and persists under zhess:helpers', () => {
    const mem = memoryStorage();
    const { result } = renderHook(() => useHelpers(createStore(mem)));
    act(() => result.current.toggleHelpers());
    expect(result.current.helpers).toBe(false);
    expect(mem.dump()['zhess:helpers']).toBe('false');
    act(() => result.current.toggleHelpers());
    expect(result.current.helpers).toBe(true);
    expect(mem.dump()['zhess:helpers']).toBe('true');
    act(() => result.current.setHelpers(false));
    expect(result.current.helpers).toBe(false);
    expect(mem.dump()['zhess:helpers']).toBe('false');
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    const { result } = renderHook(() => useHelpers(createStore(broken)));
    expect(result.current.helpers).toBe(true);
    act(() => result.current.toggleHelpers());
    expect(result.current.helpers).toBe(false);
  });
});
