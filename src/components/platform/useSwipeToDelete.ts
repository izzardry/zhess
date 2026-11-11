/**
 * Swipe-left-to-delete and the collapse animation of a list card (Ztyle 08 "Swipe to delete").
 *
 * - Touch and pen only (mouse uses the hover ×), through pointer events. The card has
 *   `touch-action: pan-y`, so the browser keeps vertical scrolling and leaves horizontal
 *   drags to us; no `preventDefault` on passive listeners is needed (Zudoku's touch handlers
 *   called it on a passive React listener).
 * - Direction lock after 8 px: the larger axis wins. Vertical lets the page scroll.
 * - Left only; a rightward drag rests at 0. Threshold: 40 % of the card width.
 * - Past the threshold the card slides out, then the wrapper collapses its height (200 ms)
 *   and `onDelete` runs. The hover × uses the same `collapse()`.
 * - A swipe suppresses the click that follows it.
 * - With `prefers-reduced-motion` the card is removed without animation.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export const SWIPE_LOCK_PX = 8;
export const SWIPE_THRESHOLD = 0.4;
export const COLLAPSE_MS = 200;

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

type Lock = 'none' | 'horizontal' | 'vertical';

export function useSwipeToDelete<W extends HTMLElement = HTMLDivElement>(onDelete: () => void) {
  const elRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<W>(null);
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const track = useRef<{ id: number; x: number; y: number; dx: number; lock: Lock } | null>(null);
  const suppressClick = useRef(false);
  const deleting = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    },
    [],
  );

  /** Collapses the wrapper's height, then calls `onDelete` once. */
  const collapse = useCallback(() => {
    if (deleting.current) return;
    deleting.current = true;
    const wrapper = wrapperRef.current;
    if (!wrapper || prefersReducedMotion()) {
      onDeleteRef.current();
      return;
    }
    const h = wrapper.offsetHeight;
    wrapper.style.height = `${h}px`;
    void wrapper.offsetHeight; // reflow, so the transition starts from the measured height
    wrapper.style.overflow = 'hidden';
    wrapper.style.transition = `height ${COLLAPSE_MS}ms ease-out, margin ${COLLAPSE_MS}ms ease-out, opacity ${COLLAPSE_MS}ms ease-out`;
    wrapper.style.height = '0px';
    wrapper.style.marginTop = '0px';
    wrapper.style.marginBottom = '0px';
    wrapper.style.opacity = '0';
    later(() => onDeleteRef.current(), COLLAPSE_MS);
  }, [later]);

  const setCard = (transform: string, opacity: string, transition = '') => {
    const el = elRef.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = transform;
    el.style.opacity = opacity;
  };

  const snapBack = useCallback(() => {
    setCard('', '', `transform ${COLLAPSE_MS}ms ease-out, opacity ${COLLAPSE_MS}ms ease-out`);
    later(() => {
      if (elRef.current) elRef.current.style.transition = '';
    }, COLLAPSE_MS + 50);
  }, [later]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' || deleting.current) return;
    track.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, lock: 'none' };
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const t = track.current;
    if (!t || t.id !== e.pointerId) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (t.lock === 'none') {
      if (Math.abs(dx) <= SWIPE_LOCK_PX && Math.abs(dy) <= SWIPE_LOCK_PX) return;
      t.lock = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      if (t.lock === 'vertical') {
        track.current = null;
        return;
      }
      try {
        elRef.current?.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is optional */
      }
    }
    if (dx >= 0) {
      t.dx = 0;
      setCard('', '');
      return;
    }
    t.dx = dx;
    const width = elRef.current?.offsetWidth || 300;
    const progress = Math.min(Math.abs(dx) / (width * SWIPE_THRESHOLD), 1);
    setCard(`translateX(${dx}px)`, `${1 - progress * 0.5}`);
  }, []);

  const finish = useCallback(
    (e: ReactPointerEvent, cancelled: boolean) => {
      const t = track.current;
      if (!t || t.id !== e.pointerId) return;
      track.current = null;
      if (t.lock !== 'horizontal') return;
      suppressClick.current = true;
      later(() => {
        suppressClick.current = false;
      }, 50);
      const width = elRef.current?.offsetWidth || 300;
      if (!cancelled && Math.abs(t.dx) >= width * SWIPE_THRESHOLD) {
        if (prefersReducedMotion()) {
          collapse();
          return;
        }
        setCard('translateX(-100%)', '0', `transform ${COLLAPSE_MS}ms ease-out, opacity ${COLLAPSE_MS}ms ease-out`);
        later(collapse, COLLAPSE_MS - 20);
      } else {
        snapBack();
      }
    },
    [collapse, later, snapBack],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent) => finish(e, false), [finish]);
  const onPointerCancel = useCallback((e: ReactPointerEvent) => finish(e, true), [finish]);

  /** True (once) when the click that just arrived ends a swipe and must be ignored. */
  const consumeSwipeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return {
    elRef,
    wrapperRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    collapse,
    consumeSwipeClick,
  };
}
