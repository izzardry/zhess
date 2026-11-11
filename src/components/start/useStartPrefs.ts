/**
 * Remembered start-screen choices (DESIGN 4.1, 13.1): `zhess:opponent`, `zhess:color`,
 * `zhess:clock`. Reads are validated and fall back to the first-run defaults.
 *
 * Stored shapes:
 * - `zhess:opponent` → the `Opponent` object, e.g. `{"mode":"computer","level":5}`
 * - `zhess:color`    → `"random"` / `"w"` / `"b"`
 * - `zhess:clock`    → `"off"` or a time control string such as `"5+0"`
 */
import { useCallback, useState } from 'react';
import { store as defaultStore } from '@/lib/storage';
import type { ColorChoice, Opponent, Store, TimeControl } from '@/lib/types';
import { formatTc, parseTc } from '@/lib/zhess';
import { DEFAULT_COLOR, DEFAULT_OPPONENT, OPPONENTS, isColorChoice, isOpponent, opponentIndex } from './options';

/** Stored value for "clock off". */
export const CLOCK_OFF = 'off';

export function readOpponent(s: Store = defaultStore): Opponent {
  const v = s.pref<unknown>('opponent', null);
  return isOpponent(v) ? OPPONENTS[opponentIndex(v)] : DEFAULT_OPPONENT;
}

export function readColor(s: Store = defaultStore): ColorChoice {
  const v = s.pref<unknown>('color', null);
  return isColorChoice(v) ? v : DEFAULT_COLOR;
}

export function readClock(s: Store = defaultStore): TimeControl {
  const v = s.pref<unknown>('clock', null);
  return typeof v === 'string' ? parseTc(v) : null;
}

export function writeClock(s: Store, tc: TimeControl): void {
  s.setPref('clock', formatTc(tc) ?? CLOCK_OFF);
}

export interface StartPrefs {
  opponent: Opponent;
  setOpponent: (o: Opponent) => void;
  color: ColorChoice;
  setColor: (c: ColorChoice) => void;
  clock: TimeControl;
  setClock: (tc: TimeControl) => void;
}

/**
 * The three remembered selector values with setters that persist immediately.
 * Pass a store in tests; the app uses the default `zhess:` localStorage store.
 */
export function useStartPrefs(s: Store = defaultStore): StartPrefs {
  const [opponent, setOpponentState] = useState<Opponent>(() => readOpponent(s));
  const [color, setColorState] = useState<ColorChoice>(() => readColor(s));
  const [clock, setClockState] = useState<TimeControl>(() => readClock(s));

  const setOpponent = useCallback(
    (o: Opponent) => {
      if (!isOpponent(o)) return;
      const v = OPPONENTS[opponentIndex(o)];
      setOpponentState(v);
      s.setPref('opponent', v);
    },
    [s],
  );

  const setColor = useCallback(
    (c: ColorChoice) => {
      if (!isColorChoice(c)) return;
      setColorState(c);
      s.setPref('color', c);
    },
    [s],
  );

  const setClock = useCallback(
    (tc: TimeControl) => {
      setClockState(tc);
      writeClock(s, tc);
    },
    [s],
  );

  return { opponent, setOpponent, color, setColor, clock, setClock };
}
