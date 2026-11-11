import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT, isMobileWidth, isTouchDevice, useIsMobile, useIsTouchDevice } from './use-mobile';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
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
const original = { w: window.innerWidth, h: window.innerHeight };
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  setViewport(original.w, original.h);
});

describe('use-mobile', () => {
  it('isMobileWidth uses the 768 px breakpoint', () => {
    expect(MOBILE_BREAKPOINT).toBe(768);
    expect(isMobileWidth(767)).toBe(true);
    expect(isMobileWidth(768)).toBe(false);
  });

  it('useIsMobile follows resizes', () => {
    setViewport(390, 844);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    act(() => {
      setViewport(1280, 800);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false);
  });

  it('isTouchDevice needs coarse pointer, no fine pointer and no hover', () => {
    expect(isTouchDevice(mockMatchMedia(['(pointer: coarse)']).mm)).toBe(true);
    expect(isTouchDevice(mockMatchMedia(['(pointer: coarse)', '(hover: hover)']).mm)).toBe(false);
    expect(isTouchDevice(mockMatchMedia(['(pointer: coarse)', '(pointer: fine)']).mm)).toBe(false);
    expect(isTouchDevice(mockMatchMedia([]).mm)).toBe(false);
    expect(isTouchDevice(null)).toBe(false);
  });

  it('useIsTouchDevice follows media changes and unsubscribes', () => {
    const m = mockMatchMedia(['(pointer: coarse)']);
    window.matchMedia = m.mm as typeof window.matchMedia;
    const { result, unmount } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
    act(() => {
      m.set(['(pointer: fine)', '(hover: hover)']);
      m.fire();
    });
    expect(result.current).toBe(false);
    unmount();
    expect(m.listeners.size).toBe(0);
  });
});
