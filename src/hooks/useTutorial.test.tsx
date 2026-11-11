import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import { useTutorial } from './useTutorial';

function mem(initial: Record<string, string> = {}) {
  const raw = memoryStorage(initial);
  return { raw, store: createStore(raw) };
}


describe('useTutorial', () => {
  it('shows on the first game only, and remembers the dismissal', () => {
    const { raw, store } = mem();
    const { result } = renderHook(() => useTutorial({ store, enabled: true }));
    expect(result.current.hasSeenTutorial).toBe(false);
    act(() => result.current.startTutorial());
    expect(result.current.showTutorial).toBe(true);
    act(() => result.current.completeTutorial());
    expect(result.current.showTutorial).toBe(false);
    expect(result.current.hasSeenTutorial).toBe(true);
    expect(raw.dump()['zhess:tutorial-seen']).toBe('true');

    act(() => result.current.startTutorial());
    expect(result.current.showTutorial).toBe(false);
  });

  it('reads the stored flag on the first render', () => {
    const { store } = mem({ 'zhess:tutorial-seen': 'true' });
    const { result } = renderHook(() => useTutorial({ store, enabled: true }));
    expect(result.current.hasSeenTutorial).toBe(true);
    act(() => result.current.startTutorial());
    expect(result.current.showTutorial).toBe(false);
  });

  it('? shows it again; reset forgets', () => {
    const { raw, store } = mem({ 'zhess:tutorial-seen': 'true' });
    const { result } = renderHook(() => useTutorial({ store, enabled: true }));
    act(() => result.current.forceShowTutorial());
    expect(result.current.showTutorial).toBe(true);
    act(() => result.current.resetTutorial());
    expect(result.current.hasSeenTutorial).toBe(false);
    expect(raw.dump()['zhess:tutorial-seen']).toBeUndefined();
  });

  it('shows nothing when the flag is off', () => {
    const { store } = mem();
    const { result } = renderHook(() => useTutorial({ store, enabled: false }));
    act(() => {
      result.current.startTutorial();
      result.current.forceShowTutorial();
    });
    expect(result.current.showTutorial).toBe(false);
  });
});
