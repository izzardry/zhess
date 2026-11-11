/**
 * Tap / hold on one element (Ztyle chapter 08, DESIGN 6.4).
 *
 * - A press shorter than `ms` is a tap: `onClick` runs on the element's normal click, so Enter,
 *   Space and assistive technology activate it like any button.
 * - Holding the primary pointer (or Space) for `ms` fires `onLongPress` and suppresses the click
 *   that follows the release. The suppression flag also resets 50 ms after release, in case no
 *   click arrives (Ztyle: "isLongPress ref, reset 50 ms later").
 * - Leaving the element or a cancelled pointer aborts a pending hold. `onLongPressEnd` runs when a
 *   hold that already fired ends (release, leave or cancel), for "while held" actions such as the
 *   threat peek.
 * - The context menu is suppressed so a long touch never opens the iOS callout.
 *
 * Spread the returned handlers on a button. Callbacks may change between renders; the latest are used.
 */
import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';

/** Hold durations of the long-press ladder (DESIGN 6.4). */
export const HOLD_MS = {
  promotion: 300,
  clockPill: 500,
  flag: 500,
  step: 500,
  hint: 1000,
  help: 3000,
} as const;

export interface LongPressOptions {
  /** Hold duration in ms. */
  ms: number;
  /** Fires once the hold reaches `ms`. */
  onLongPress: () => void;
  /** A short press (normal click, Enter, Space). Receives the click event. */
  onClick?: (e: React.MouseEvent) => void;
  /** The hold that fired has ended (release, leave, cancel). */
  onLongPressEnd?: () => void;
  /** No timers start and clicks pass through to `onClick` unchanged (which a disabled button never gets). */
  disabled?: boolean;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onKeyUp: (e: React.KeyboardEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/** Window after a release during which a stray click is still treated as part of the hold. */
const SUPPRESS_RESET_MS = 50;

export function useLongPress(options: LongPressOptions): LongPressHandlers {
  const opts = useRef(options);
  opts.current = options;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A hold has fired and its trailing click is still to be swallowed. */
  const fired = useRef(false);
  /** A hold has fired and `onLongPressEnd` has not run yet. */
  const holding = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const start = useCallback(() => {
    if (opts.current.disabled) return;
    clearTimer();
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
    fired.current = false;
    timer.current = setTimeout(() => {
      timer.current = null;
      fired.current = true;
      holding.current = true;
      opts.current.onLongPress();
    }, opts.current.ms);
  }, []);

  /** Ends a press; `released` = the press ended normally (a click may follow). */
  const finish = useCallback((released: boolean) => {
    clearTimer();
    if (holding.current) {
      holding.current = false;
      opts.current.onLongPressEnd?.();
    }
    if (fired.current) {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(
        () => {
          fired.current = false;
          resetTimer.current = null;
        },
        released ? SUPPRESS_RESET_MS : 0,
      );
    }
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  return {
    onPointerDown: (e) => {
      if (e.button > 0) return; // primary button only (jsdom leaves it undefined)
      start();
    },
    onPointerUp: () => finish(true),
    onPointerLeave: () => finish(false),
    onPointerCancel: () => finish(false),
    onKeyDown: (e) => {
      // Space activates a button on key-up, so holding it can be a long press. Enter clicks on key-down.
      if (e.key !== ' ' || e.repeat) return;
      start();
    },
    onKeyUp: (e) => {
      if (e.key !== ' ') return;
      finish(true);
    },
    onClick: (e) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        return;
      }
      opts.current.onClick?.(e);
    },
    onContextMenu: (e) => {
      e.preventDefault();
    },
  };
}
