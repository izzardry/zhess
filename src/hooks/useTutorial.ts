/**
 * Coach-mark tutorial state (DESIGN 14.2, Ztyle 15).
 *
 * Shown automatically on the first game (`startTutorial`), again any time through `?`
 * (`forceShowTutorial`). Dismissing stores `zhess:tutorial-seen = true`.
 * Ported from Zudoku `useTutorial.ts` with the storage key fix (Ztyle audit #13): the flag is
 * read synchronously, so `startTutorial` works on the first render.
 */
import { useCallback, useState } from 'react';
import { flags } from '@/lib/flags';
import { store as defaultStore } from '@/lib/storage';
import type { Store } from '@/lib/types';

export const TUTORIAL_SEEN_KEY = 'tutorial-seen';

export interface UseTutorialOptions {
  /** Where the flag lives; the app store by default (tests pass a memory store). */
  store?: Store;
  /** Feature flag; `flags.tutorial` by default. When false nothing is ever shown. */
  enabled?: boolean;
}

export interface TutorialState {
  /** The tutorial was dismissed before on this device. */
  hasSeenTutorial: boolean;
  /** Render `<TutorialOverlay>` while true. */
  showTutorial: boolean;
  /** Call when a game starts: shows the tutorial only if it was never seen. */
  startTutorial: () => void;
  /** The `?` button: shows it regardless. */
  forceShowTutorial: () => void;
  /** `TutorialOverlay.onDismiss`: hides it and remembers that it was seen. */
  completeTutorial: () => void;
  /** Forget that it was seen (tests, debugging). */
  resetTutorial: () => void;
}

export function useTutorial({ store = defaultStore, enabled = flags.tutorial }: UseTutorialOptions = {}): TutorialState {
  const [hasSeenTutorial, setHasSeen] = useState(() => store.pref<boolean>(TUTORIAL_SEEN_KEY, false) === true);
  const [showTutorial, setShow] = useState(false);

  const startTutorial = useCallback(() => {
    if (!enabled) return;
    if (store.pref<boolean>(TUTORIAL_SEEN_KEY, false) !== true) setShow(true);
  }, [enabled, store]);

  const forceShowTutorial = useCallback(() => {
    if (enabled) setShow(true);
  }, [enabled]);

  const completeTutorial = useCallback(() => {
    setShow(false);
    setHasSeen(true);
    store.setPref(TUTORIAL_SEEN_KEY, true);
  }, [store]);

  const resetTutorial = useCallback(() => {
    store.setPref(TUTORIAL_SEEN_KEY, undefined);
    setHasSeen(false);
  }, [store]);

  return { hasSeenTutorial, showTutorial, startTutorial, forceShowTutorial, completeTutorial, resetTutorial };
}
