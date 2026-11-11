/**
 * The helpers shield (DESIGN 7.1): one toggle, on by default, stored in `zhess:helpers`.
 * It bundles legal-move dots, last move, check glow, coordinates and the blunder guard.
 */
import { useCallback, useState } from 'react';
import { store as defaultStore } from '@/lib/storage';
import type { Store } from '@/lib/types';

export interface HelpersState {
  /** True when helpers are on. */
  helpers: boolean;
  setHelpers: (on: boolean) => void;
  toggleHelpers: () => void;
}

/** Reads `zhess:helpers` (default true; anything but a boolean counts as missing). */
export function readHelpers(s: Store = defaultStore): boolean {
  return s.pref<boolean>('helpers', true) !== false;
}

export function useHelpers(s: Store = defaultStore): HelpersState {
  const [helpers, setState] = useState<boolean>(() => readHelpers(s));

  const setHelpers = useCallback(
    (on: boolean) => {
      setState(on);
      s.setPref('helpers', on);
    },
    [s],
  );

  const toggleHelpers = useCallback(() => {
    setState((prev) => {
      const next = !prev;
      s.setPref('helpers', next);
      return next;
    });
  }, [s]);

  return { helpers, setHelpers, toggleHelpers };
}
