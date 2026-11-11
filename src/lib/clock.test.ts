import { describe, expect, it } from 'vitest';
import {
  DIAL_GEOMETRY,
  DIAL_INCREMENTS,
  DIAL_MINUTES,
  clockView,
  customTc,
  dialAim,
  dialItemOffset,
  flagged,
  isCounting,
  msUntilFlag,
  nearestIndex,
  remaining,
  tickInterval,
  timerElapsed,
  timerPause,
  timerReset,
  timerResume,
  timerSet,
  toTimeControl,
} from './clock';
import type { Game, TimeControl } from './types';
import zhess, { parseTc } from './zhess';

const TC_1_0: TimeControl = { baseMs: 60_000, incMs: 0 };
const TC_3_2: TimeControl = { baseMs: 180_000, incMs: 2_000 };

/** Plays UCI moves with the given ms each. */
function playAll(moves: [string, number][], g: Game = zhess.newGame()): Game {
  return moves.reduce((acc, [m, ms]) => zhess.play(acc, m, ms), g);
}

describe('toTimeControl', () => {
  it('accepts objects, strings and off', () => {
    expect(toTimeControl(TC_3_2)).toEqual(TC_3_2);
    expect(toTimeControl('3+2')).toEqual(TC_3_2);
    expect(toTimeControl('off')).toBeNull();
    expect(toTimeControl(null)).toBeNull();
    expect(toTimeControl(undefined)).toBeNull();
    expect(toTimeControl({ baseMs: 0, incMs: 0 })).toBeNull();
  });
});

describe('turn timer (injected now)', () => {
  it('runs from its start and banks time across a pause', () => {
    let t = timerReset(true, 1000);
    expect(timerElapsed(t, 1000)).toBe(0);
    expect(timerElapsed(t, 3500)).toBe(2500);
    t = timerPause(t, 4000);
    expect(t).toEqual({ used: 3000, since: null });
    // A hidden tab for a minute: nothing counts.
    expect(timerElapsed(t, 64_000)).toBe(3000);
    t = timerResume(t, 64_000);
    expect(timerElapsed(t, 65_000)).toBe(4000);
  });

  it('pause and resume are idempotent; timerSet follows the flag', () => {
    const run = timerReset(true, 0);
    expect(timerResume(run, 50)).toBe(run);
    const stopped = timerPause(run, 100);
    expect(timerPause(stopped, 900)).toBe(stopped);
    expect(timerSet(stopped, false, 2000)).toBe(stopped);
    expect(timerSet(stopped, true, 2000)).toEqual({ used: 100, since: 2000 });
  });

  it('a paused reset carries initial time; a backwards clock never counts negative', () => {
    const t = timerReset(false, 500, 1200);
    expect(timerElapsed(t, 99_999)).toBe(1200);
    expect(timerElapsed(timerReset(true, 1000), 900)).toBe(0);
    expect(timerReset(true, 0, -50).used).toBe(0);
  });
});

describe('remaining', () => {
  it('first move of each side is untimed, then Fischer increment applies', () => {
    // White 1.e4 (untimed, 5 s), black 1...e5 (untimed, 7 s), white 2.Nf3 3 s, black 2...Nc6 4 s.
    const g = playAll([
      ['e2e4', 5000],
      ['e7e5', 7000],
      ['g1f3', 3000],
      ['b8c6', 4000],
    ]);
    expect(remaining(g, TC_3_2, 0)).toEqual({ w: 180_000 - 3000 + 2000, b: 180_000 - 4000 + 2000 });
    // White to move, 10 s into the turn.
    expect(remaining(g, TC_3_2, 10_000)).toEqual({ w: 179_000 - 10_000, b: 178_000 });
  });

  it('does not count the running turn before the side has moved once', () => {
    const g0 = zhess.newGame();
    expect(remaining(g0, TC_1_0, 30_000)).toEqual({ w: 60_000, b: 60_000 });
    const g1 = playAll([['e2e4', 1000]]);
    expect(remaining(g1, TC_1_0, 30_000)).toEqual({ w: 60_000, b: 60_000 });
    const g2 = playAll([['e2e4', 1000], ['e7e5', 1000]]);
    expect(remaining(g2, TC_1_0, 30_000)).toEqual({ w: 30_000, b: 60_000 });
  });

  it('clock off: time used per side, plus the running turn', () => {
    const g = playAll([
      ['e2e4', 5000],
      ['e7e5', 7000],
    ]);
    expect(remaining(g, null, 0)).toEqual({ w: 5000, b: 7000 });
    expect(remaining(g, null, 2500)).toEqual({ w: 7500, b: 7000 });
  });

  it('goes negative past the flag and ignores the turn once the game is over', () => {
    const g = playAll([['e2e4', 0], ['e7e5', 0]]);
    expect(remaining(g, TC_1_0, 61_000).w).toBe(-1000);
    const over = zhess.timeout(g, 'w');
    expect(remaining(over, TC_1_0, 61_000).w).toBe(60_000);
  });

  it('undo and redo restore the clocks from the log', () => {
    const moves: [string, number][] = [
      ['e2e4', 1000],
      ['e7e5', 1000],
      ['g1f3', 20_000],
      ['b8c6', 15_000],
      ['f1c4', 9_000],
    ];
    const g = playAll(moves);
    expect(remaining(g, TC_3_2, 0)).toEqual({ w: 180_000 - 29_000 + 4000, b: 180_000 - 15_000 + 2000 });
    const back = zhess.undo(g, 2);
    expect(remaining(back, TC_3_2, 0)).toEqual({ w: 180_000 - 20_000 + 2000, b: 180_000 });
    const again = zhess.redo(back, 2);
    expect(remaining(again, TC_3_2, 0)).toEqual(remaining(g, TC_3_2, 0));
  });
});

describe('flagged / msUntilFlag / isCounting', () => {
  const g = playAll([['e2e4', 0], ['e7e5', 0], ['g1f3', 50_000], ['b8c6', 0]]);
  it('flags the side to move at zero', () => {
    expect(isCounting(g, TC_1_0)).toBe(true);
    expect(msUntilFlag(g, TC_1_0, 0)).toBe(10_000);
    expect(flagged(g, TC_1_0, 9_999)).toBeNull();
    expect(flagged(g, TC_1_0, 10_000)).toBe('w');
    expect(msUntilFlag(g, TC_1_0, 12_000)).toBe(0);
  });
  it('never flags without a clock, before the first move, or after the end', () => {
    expect(flagged(g, null, 1e9)).toBeNull();
    expect(msUntilFlag(g, null, 0)).toBeNull();
    expect(flagged(zhess.newGame(), TC_1_0, 1e9)).toBeNull();
    expect(flagged(zhess.end(g, '0-1', 'resign'), TC_1_0, 1e9)).toBeNull();
  });
});

describe('clockView', () => {
  it('formats m:ss, marks the running side, and switches to tenths below 10 s', () => {
    const g = playAll([['e2e4', 0], ['e7e5', 0], ['g1f3', 0], ['b8c6', 0]]);
    const v = clockView(g, TC_1_0, 1500);
    expect(v.timed).toBe(true);
    expect(v.counting).toBe(true);
    expect(v.w).toEqual({ text: '0:58', running: true, low: false, flagged: false, untimed: false, ms: 58_500 });
    expect(v.b).toEqual({ text: '1:00', running: false, low: false, flagged: false, untimed: false, ms: 60_000 });
    const low = clockView(g, TC_1_0, 50_750);
    expect(low.w.text).toBe('9.2');
    expect(low.w.low).toBe(true);
  });

  it('shows 0.0 flagged at zero and on a loss on time', () => {
    const g = playAll([['e2e4', 0], ['e7e5', 0]]);
    const atZero = clockView(g, TC_1_0, 60_400);
    expect(atZero.w).toMatchObject({ text: '0.0', flagged: true, ms: 0, low: true });
    expect(atZero.flagged).toBe('w');
    const lost = zhess.timeout(g, 'w');
    const after = clockView(lost, TC_1_0, 0);
    expect(after.w).toMatchObject({ text: '0.0', flagged: true, running: false });
    expect(after.b.flagged).toBe(false);
    expect(after.flagged).toBe('w');
    expect(after.counting).toBe(false);
  });

  it('a paused turn keeps its spent time but is not drawn as running', () => {
    const g = playAll([['e2e4', 0], ['e7e5', 0]]);
    const v = clockView(g, TC_1_0, 5000, { live: false });
    expect(v.w).toMatchObject({ text: '0:55', running: false });
  });

  it('clock off: dimmed time used, never running or flagged', () => {
    const g = playAll([['e2e4', 65_000]]);
    const v = clockView(g, null, 3000);
    expect(v.timed).toBe(false);
    expect(v.w).toEqual({ text: '1:05', running: false, low: false, flagged: false, untimed: true, ms: 65_000 });
    expect(v.b).toEqual({ text: '0:03', running: false, low: false, flagged: false, untimed: true, ms: 3000 });
    expect(v.flagged).toBeNull();
  });

  it('the first move of each side does not run the clock', () => {
    const v = clockView(zhess.newGame(), TC_1_0, 20_000);
    expect(v.w).toMatchObject({ text: '1:00', running: false });
    expect(v.counting).toBe(false);
  });
});

describe('tick and dial helpers', () => {
  it('ticks every 100 ms with a clock and 250 ms without', () => {
    expect(tickInterval(TC_1_0)).toBe(100);
    expect(tickInterval(null)).toBe(250);
  });

  it('dial values make valid time controls', () => {
    expect(DIAL_MINUTES.length).toBeLessThanOrEqual(9);
    expect(DIAL_INCREMENTS.length).toBeLessThanOrEqual(9);
    for (const m of DIAL_MINUTES)
      for (const i of DIAL_INCREMENTS) expect(parseTc(customTc(m, i))).toEqual({ baseMs: m * 60_000, incMs: i * 1000 });
    expect(customTc(20, 5)).toBe('20+5');
  });

  it('nearestIndex finds the closest value', () => {
    expect(nearestIndex(DIAL_MINUTES, 5)).toBe(DIAL_MINUTES.indexOf(5));
    expect(nearestIndex(DIAL_MINUTES, 4)).toBe(DIAL_MINUTES.indexOf(3));
    expect(nearestIndex(DIAL_MINUTES, 1000)).toBe(DIAL_MINUTES.length - 1);
  });

  it('dialAim follows the Ztyle zones and angles', () => {
    const n = 9;
    expect(dialAim(0, 10, n)).toEqual({ zone: 'center', index: null });
    expect(dialAim(0, -30, n)).toEqual({ zone: 'none', index: null });
    expect(dialAim(0, -45, n)).toEqual({ zone: 'aim', index: 0 });
    expect(dialAim(0, -60, n)).toEqual({ zone: 'commit', index: 0 });
    // Straight right is 90°: item 2 of 9 sits at 80°, item 3 at 120°.
    expect(dialAim(60, 0, n).index).toBe(2);
    // Every item's own position aims at itself.
    for (let i = 0; i < n; i++) {
      const p = dialItemOffset(i, n, DIAL_GEOMETRY.radius);
      expect(dialAim(p.x, p.y, n)).toEqual({ zone: 'commit', index: i });
    }
  });
});
