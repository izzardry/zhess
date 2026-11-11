import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import { DONATION_DELAY_MS, useDonationPrompt } from './useDonationPrompt';

function mem(initial: Record<string, string> = {}) {
  const raw = memoryStorage(initial);
  return { raw, store: createStore(raw) };
}


describe('useDonationPrompt', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows once per device, after the delay', () => {
    const { raw, store } = mem();
    const { result } = renderHook(() => useDonationPrompt({ store, enabled: true }));
    let scheduled = false;
    act(() => {
      scheduled = result.current.triggerPrompt(DONATION_DELAY_MS);
    });
    expect(scheduled).toBe(true);
    expect(result.current.showPrompt).toBe(false);
    act(() => vi.advanceTimersByTime(DONATION_DELAY_MS));
    expect(result.current.showPrompt).toBe(true);
    expect(raw.dump()['zhess:donation-shown']).toBe('true');

    act(() => result.current.dismissPrompt());
    expect(result.current.showPrompt).toBe(false);
    act(() => {
      scheduled = result.current.triggerPrompt();
    });
    expect(scheduled).toBe(false);
    expect(result.current.showPrompt).toBe(false);
  });

  it('never shows when it was shown before', () => {
    const { store } = mem({ 'zhess:donation-shown': 'true' });
    const { result } = renderHook(() => useDonationPrompt({ store, enabled: true }));
    expect(result.current.hasShownPrompt).toBe(true);
    act(() => void result.current.triggerPrompt());
    expect(result.current.showPrompt).toBe(false);
  });

  it('shows at once without a delay (easter egg)', () => {
    const { store } = mem();
    const { result } = renderHook(() => useDonationPrompt({ store, enabled: true }));
    act(() => void result.current.triggerPrompt());
    expect(result.current.showPrompt).toBe(true);
  });

  it('a pending prompt is dropped on unmount and stays available', () => {
    const { raw, store } = mem();
    const { result, unmount } = renderHook(() => useDonationPrompt({ store, enabled: true }));
    act(() => void result.current.triggerPrompt(DONATION_DELAY_MS));
    unmount();
    act(() => vi.advanceTimersByTime(DONATION_DELAY_MS));
    expect(raw.dump()['zhess:donation-shown']).toBeUndefined();
  });

  it('does nothing when the flag is off', () => {
    const { store } = mem();
    const { result } = renderHook(() => useDonationPrompt({ store, enabled: false }));
    act(() => void result.current.triggerPrompt());
    expect(result.current.showPrompt).toBe(false);
  });
});
