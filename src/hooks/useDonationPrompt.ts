/**
 * Once-per-device donation prompt (Ztyle 13, DESIGN 8.4).
 *
 * `triggerPrompt(1500)` after the first win (1.5 s after the overlay appears), or
 * `triggerPrompt()` from the 3-second help-button easter egg. The prompt is shown at most once
 * per device, ever: `zhess:donation-shown` is written the moment it opens.
 * Ported from Zudoku `useDonationPrompt.ts` with the storage key fix (Ztyle audit #13) and a
 * delay that is cancelled on unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { flags } from '@/lib/flags';
import { store as defaultStore } from '@/lib/storage';
import type { Store } from '@/lib/types';

export const DONATION_SHOWN_KEY = 'donation-shown';
/** Delay after the game-over overlay (Ztyle 09, 13). */
export const DONATION_DELAY_MS = 1500;

export interface UseDonationPromptOptions {
  store?: Store;
  /** Feature flag; `flags.donationPrompt` by default. */
  enabled?: boolean;
}

export interface DonationPromptState {
  /** Pass to `<DonationPrompt open>`. */
  showPrompt: boolean;
  /** It has been shown on this device before (so it never shows again). */
  hasShownPrompt: boolean;
  /**
   * Shows the prompt after `delayMs` (default 0) unless it was shown before or one is already
   * scheduled. Returns true when it will show.
   */
  triggerPrompt: (delayMs?: number) => boolean;
  /** `<DonationPrompt onDismiss>`. */
  dismissPrompt: () => void;
}

export function useDonationPrompt({
  store = defaultStore,
  enabled = flags.donationPrompt,
}: UseDonationPromptOptions = {}): DonationPromptState {
  const [hasShownPrompt, setHasShown] = useState(() => store.pref<boolean>(DONATION_SHOWN_KEY, false) === true);
  const [showPrompt, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const triggerPrompt = useCallback(
    (delayMs = 0) => {
      if (!enabled || timer.current) return false;
      if (store.pref<boolean>(DONATION_SHOWN_KEY, false) === true) return false;
      const open = () => {
        timer.current = null;
        if (store.pref<boolean>(DONATION_SHOWN_KEY, false) === true) return;
        store.setPref(DONATION_SHOWN_KEY, true);
        setHasShown(true);
        setShow(true);
      };
      if (delayMs > 0) timer.current = setTimeout(open, delayMs);
      else open();
      return true;
    },
    [enabled, store],
  );

  const dismissPrompt = useCallback(() => setShow(false), []);

  return { showPrompt, hasShownPrompt, triggerPrompt, dismissPrompt };
}
