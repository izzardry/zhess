import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import { usePWAInstall, type BeforeInstallPromptEvent } from './usePWAInstall';

function mem(initial: Record<string, string> = {}) {
  const raw = memoryStorage(initial);
  return { raw, store: createStore(raw) };
}

/** matchMedia where the listed queries match; `fire()` notifies change listeners. */
function mockMatchMedia(matching: string[]) {
  const listeners = new Set<() => void>();
  const mm = (query: string) =>
    ({
      matches: matching.includes(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  return {
    mm,
    set(next: string[]) {
      matching.splice(0, matching.length, ...next);
    },
    fire() {
      for (const l of [...listeners]) l();
    },
    listeners,
  };
}

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('usePWAInstall', () => {
  function promptEvent(outcome: 'accepted' | 'dismissed') {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
    const prompt = vi.fn(() => Promise.resolve());
    Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome }) });
    return { e, prompt };
  }

  it('offers install after beforeinstallprompt and installs on accept', async () => {
    const { store } = mem();
    const { result } = renderHook(() => usePWAInstall({ store, enabled: true }));
    expect(result.current.canInstall).toBe(false);
    const { e, prompt } = promptEvent('accepted');
    act(() => void window.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
    expect(result.current.shouldShowPrompt).toBe(true);
    expect(result.current.canInstall).toBe(true);

    let accepted = false;
    await act(async () => {
      accepted = await result.current.install();
    });
    expect(prompt).toHaveBeenCalled();
    expect(accepted).toBe(true);
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('drops a used prompt even when the user declines', async () => {
    const { store } = mem();
    const { result } = renderHook(() => usePWAInstall({ store, enabled: true }));
    act(() => void window.dispatchEvent(promptEvent('dismissed').e));
    await act(async () => void (await result.current.install()));
    expect(result.current.canInstall).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it('"Not now" hides the sheet for good and keeps the pill', () => {
    const { raw, store } = mem();
    const { result } = renderHook(() => usePWAInstall({ store, enabled: true }));
    act(() => void window.dispatchEvent(promptEvent('accepted').e));
    act(() => result.current.dismiss());
    expect(result.current.shouldShowPrompt).toBe(false);
    expect(result.current.canInstall).toBe(true);
    expect(raw.dump()['zhess:install-dismissed']).toBe('true');

    const again = renderHook(() => usePWAInstall({ store, enabled: true }));
    expect(again.result.current.wasDismissed).toBe(true);
    act(() => again.result.current.resetDismissal());
    expect(again.result.current.wasDismissed).toBe(false);
  });

  it('hides everything once installed', () => {
    const { store } = mem();
    const { result } = renderHook(() => usePWAInstall({ store, enabled: true }));
    act(() => void window.dispatchEvent(promptEvent('accepted').e));
    act(() => void window.dispatchEvent(new Event('appinstalled')));
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('knows it runs installed (display-mode: standalone)', () => {
    window.matchMedia = mockMatchMedia(['(display-mode: standalone)']).mm as typeof window.matchMedia;
    const { store } = mem();
    const { result } = renderHook(() => usePWAInstall({ store, enabled: true }));
    expect(result.current.isInstalled).toBe(true);
    act(() => void window.dispatchEvent(promptEvent('accepted').e));
    expect(result.current.canInstall).toBe(false);
  });

  it('ignores the event when the flag is off', () => {
    const { store } = mem();
    const { result } = renderHook(() => usePWAInstall({ store, enabled: false }));
    const { e } = promptEvent('accepted');
    act(() => void window.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(false);
    expect(result.current.canInstall).toBe(false);
  });
});
