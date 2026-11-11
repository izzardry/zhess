/**
 * Pass-and-play seating (DESIGN 5.2), stored in `zhess:seating`.
 *
 * - `face`: face to face, the far player's pieces, strip and clock drawn rotated 180°.
 *   Default on touch devices.
 * - `side`: side by side, everything upright. Default with a mouse.
 *
 * Touch devices are detected as Ztyle chapter 05 says: by pointer and hover capability, not by width.
 */
import { useCallback, useState } from 'react';
import { store as defaultStore } from '@/lib/storage';
import type { Seating, Store } from '@/lib/types';

/** Ztyle's touch-device query. */
export const TOUCH_QUERY = '(pointer: coarse) and (not (pointer: fine)) and (not (hover: hover))';

/** True on a touch-only device. False when `matchMedia` is missing. */
export function isTouchDevice(win: Pick<Window, 'matchMedia'> | undefined = globalThis.window): boolean {
  try {
    if (!win?.matchMedia) return false;
    if (win.matchMedia(TOUCH_QUERY).matches) return true;
    // Older engines do not parse `not (...)` inside a media query; fall back to the plain parts.
    return win.matchMedia('(pointer: coarse)').matches && !win.matchMedia('(hover: hover)').matches;
  } catch {
    return false;
  }
}

/** Seating used when nothing is stored: face to face on touch devices, side by side otherwise. */
export function defaultSeating(win?: Pick<Window, 'matchMedia'>): Seating {
  return isTouchDevice(win) ? 'face' : 'side';
}

function isSeating(v: unknown): v is Seating {
  return v === 'face' || v === 'side';
}

/** Stored seating, or the device default. */
export function readSeating(s: Store = defaultStore, win?: Pick<Window, 'matchMedia'>): Seating {
  const stored = s.pref<string>('seating', ''); // string fallback also accepts a bare, non-JSON value
  return isSeating(stored) ? stored : defaultSeating(win);
}

export interface SeatingState {
  seating: Seating;
  setSeating: (s: Seating) => void;
  toggleSeating: () => void;
}

export function useSeating(s: Store = defaultStore): SeatingState {
  const [seating, setState] = useState<Seating>(() => readSeating(s));

  const setSeating = useCallback(
    (next: Seating) => {
      setState(next);
      s.setPref('seating', next);
    },
    [s],
  );

  const toggleSeating = useCallback(() => {
    setState((prev) => {
      const next: Seating = prev === 'face' ? 'side' : 'face';
      s.setPref('seating', next);
      return next;
    });
  }, [s]);

  return { seating, setSeating, toggleSeating };
}
