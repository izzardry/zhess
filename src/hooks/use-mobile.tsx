/**
 * Device-class hooks (Ztyle 05 "Breakpoints").
 *
 * - `useIsMobile`: viewport narrower than `MOBILE_BREAKPOINT` (768 px). Use it for layout
 *   behavior that depends on width (e.g. show the support button only after scrolling).
 * - `useIsTouchDevice`: a touch-primary device, by `(pointer: coarse)` without a fine pointer
 *   and without hover. Use it for input behavior (gesture texts, swipe vs. hover), not width.
 *
 * Ported from Zudoku `use-mobile.tsx`; the touch check is Zudoku's tutorial `useIsMobileDevice`.
 */
import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;

type MatchMedia = (query: string) => MediaQueryList;

function getMatchMedia(): MatchMedia | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
}

/** True when the viewport is narrower than 768 px. */
export function isMobileWidth(width: number = typeof window !== 'undefined' ? window.innerWidth : MOBILE_BREAKPOINT): boolean {
  return width < MOBILE_BREAKPOINT;
}

/** Touch-primary device: coarse pointer, no fine pointer, no hover (Ztyle 05). */
export function isTouchDevice(mm: MatchMedia | null = getMatchMedia()): boolean {
  if (!mm) return false;
  try {
    return mm('(pointer: coarse)').matches && !mm('(pointer: fine)').matches && !mm('(hover: hover)').matches;
  } catch {
    return false;
  }
}

/** Subscribes to `change` of several media queries; returns the cleanup. */
function onMediaChange(queries: string[], cb: () => void): () => void {
  const mm = getMatchMedia();
  if (!mm) return () => {};
  const lists = queries.map((q) => {
    try {
      return mm(q);
    } catch {
      return null;
    }
  });
  for (const l of lists) l?.addEventListener?.('change', cb);
  return () => {
    for (const l of lists) l?.removeEventListener?.('change', cb);
  };
}

/** Viewport narrower than 768 px; follows resizes. */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => isMobileWidth());

  useEffect(() => {
    const update = () => setMobile(isMobileWidth(window.innerWidth));
    update();
    const off = onMediaChange([`(max-width: ${MOBILE_BREAKPOINT - 1}px)`], update);
    window.addEventListener('resize', update);
    return () => {
      off();
      window.removeEventListener('resize', update);
    };
  }, []);

  return mobile;
}

/** Touch-primary device; follows pointer changes (e.g. a mouse plugged into a tablet). */
export function useIsTouchDevice(): boolean {
  const [touch, setTouch] = useState(() => isTouchDevice());

  useEffect(() => {
    const update = () => setTouch(isTouchDevice());
    update();
    return onMediaChange(['(pointer: coarse)', '(pointer: fine)', '(hover: hover)'], update);
  }, []);

  return touch;
}
