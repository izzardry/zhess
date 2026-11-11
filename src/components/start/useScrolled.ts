/**
 * Start-screen scroll helpers (Ztyle 08 "Scrolling"): the header swaps for the sticky one and the
 * back-to-top FAB appears after 50 px; the chevron scrolls one viewport.
 */
import { useEffect, useState } from 'react';

/** Scroll distance after which the start screen counts as scrolled. */
export const SCROLL_THRESHOLD = 50;

/** True while `window.scrollY > threshold`. Always false while `enabled` is false (in game). */
export function useScrolled(threshold: number = SCROLL_THRESHOLD, enabled = true): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setScrolled(false);
      return;
    }
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [threshold, enabled]);

  return enabled && scrolled;
}

/** `smooth`, or `auto` when the user prefers reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'smooth';
  }
}

/** Scrolls down by one viewport height (the bounce chevron). */
export function scrollOneViewport(): void {
  window.scrollTo({ top: window.innerHeight, behavior: scrollBehavior() });
}

/** Scrolls back to the top (the back-to-top FAB). */
export function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
}
