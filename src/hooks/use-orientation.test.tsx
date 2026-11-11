import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { isMobileLandscape, useIsMobileLandscape, useOrientation } from './use-orientation';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
}

const original = { w: window.innerWidth, h: window.innerHeight };
afterEach(() => {
  setViewport(original.w, original.h);
});

describe('use-orientation', () => {
  it('applies the Ztyle mobile landscape rule', () => {
    expect(isMobileLandscape(844, 390)).toBe(true);
    expect(isMobileLandscape(390, 844)).toBe(false);
    expect(isMobileLandscape(1280, 800)).toBe(false); // desktop stays portrait
    expect(isMobileLandscape(1024, 767)).toBe(true);
    expect(isMobileLandscape(700, 700)).toBe(false);
  });

  it('follows resize and orientationchange', () => {
    setViewport(390, 844);
    const { result } = renderHook(() => ({ l: useIsMobileLandscape(), o: useOrientation() }));
    expect(result.current).toEqual({ l: false, o: 'portrait' });
    act(() => {
      setViewport(844, 390);
      window.dispatchEvent(new Event('orientationchange'));
    });
    expect(result.current).toEqual({ l: true, o: 'landscape' });
  });
});
