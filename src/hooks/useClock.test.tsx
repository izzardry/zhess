import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Color, Game, TcString, TimeControl } from '@/lib/types';
import zhess from '@/lib/zhess';
import { useClock, usePremove, type UseClockOptions, type UsePremoveOptions } from './useClock';

function playAll(moves: [string, number][], g: Game = zhess.newGame()): Game {
  return moves.reduce((acc, [m, ms]) => zhess.play(acc, m, ms), g);
}

/** Both sides have moved once, so white's clock runs: 1.e4 e5, white to move. */
const opened = playAll([
  ['e2e4', 0],
  ['e7e5', 0],
]);
const ONE_MIN = '1+0';

let clock = 0;
const now = () => clock;
let visibility: DocumentVisibilityState = 'visible';

function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Moves the injected clock and lets the display tick run. */
function advance(ms: number) {
  act(() => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
});

interface Props {
  game: Game | null;
  tc: TimeControl | TcString | null;
  opts?: UseClockOptions;
}

function mount(game: Game | null, tc: TimeControl | TcString | null, opts: UseClockOptions = {}) {
  return renderHook((p: Props) => useClock(p.game, p.tc, { now, ...p.opts }), {
    initialProps: { game, tc, opts },
  });
}

describe('useClock', () => {
  it('counts the side to move down from performance stamps and shows it on the tick', () => {
    const { result } = mount(opened, ONE_MIN);
    expect(result.current.ticking).toBe(true);
    expect(result.current.w).toMatchObject({ text: '1:00', running: true });
    advance(1500);
    expect(result.current.elapsed()).toBe(1500);
    expect(result.current.w).toMatchObject({ text: '0:58', running: true });
    expect(result.current.b).toMatchObject({ text: '1:00', running: false });
  });

  it('derives from stamps, not ticks: a throttled tick loses nothing', () => {
    const { result } = mount(opened, ONE_MIN);
    // 30 s pass but only one tick runs (a throttled background timer).
    act(() => {
      clock += 30_000;
      vi.advanceTimersByTime(100);
    });
    expect(result.current.turnMs).toBe(30_000);
    expect(result.current.w.text).toBe('0:30');
  });

  it('pauses while the tab is hidden and resumes on return (solo)', () => {
    const { result } = mount(opened, ONE_MIN);
    advance(2000);
    setVisibility('hidden');
    expect(result.current.ticking).toBe(false);
    advance(60_000);
    expect(result.current.elapsed()).toBe(2000);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('visible');
    expect(result.current.ticking).toBe(true);
    advance(1000);
    expect(result.current.elapsed()).toBe(3000);
    expect(result.current.w.text).toBe('0:57');
  });

  it('keeps running while hidden when pauseWhenHidden is false', () => {
    const { result } = mount(opened, ONE_MIN, { pauseWhenHidden: false });
    setVisibility('hidden');
    advance(5000);
    expect(result.current.elapsed()).toBe(5000);
  });

  it('pauses on `paused` (Back / leave) and when inactive, keeping the time spent', () => {
    const { result, rerender } = mount(opened, ONE_MIN);
    advance(4000);
    rerender({ game: opened, tc: ONE_MIN, opts: { paused: true } });
    expect(result.current.ticking).toBe(false);
    expect(result.current.w).toMatchObject({ text: '0:56', running: false });
    advance(20_000);
    rerender({ game: opened, tc: ONE_MIN, opts: { active: false } });
    advance(20_000);
    expect(result.current.elapsed()).toBe(4000);
    rerender({ game: opened, tc: ONE_MIN, opts: {} });
    advance(1000);
    expect(result.current.elapsed()).toBe(5000);
  });

  it('a move starts a new turn; elapsed() is the ms of the move being made', () => {
    const { result, rerender } = mount(opened, ONE_MIN);
    advance(7000);
    const ms = result.current.elapsed();
    expect(ms).toBe(7000);
    const next = zhess.play(opened, 'g1f3', ms);
    rerender({ game: next, tc: ONE_MIN, opts: {} });
    expect(result.current.elapsed()).toBe(0);
    expect(result.current.w).toMatchObject({ text: '0:53', running: false });
    expect(result.current.b).toMatchObject({ text: '1:00', running: true });
    advance(2000);
    expect(result.current.b.text).toBe('0:58');
  });

  it('applies the Fischer increment after each counted move', () => {
    const tc: TcString = '1+5';
    const g = playAll([['g1f3', 3000]], opened);
    const { result } = mount(g, tc);
    // White: 60 - 3 + 5 = 62 s.
    expect(result.current.w.text).toBe('1:02');
  });

  it('undo and redo restore the clocks from the log', () => {
    const g = playAll(
      [
        ['g1f3', 12_000],
        ['b8c6', 8_000],
      ],
      opened,
    );
    const { result, rerender } = mount(g, ONE_MIN);
    expect(result.current.w.text).toBe('0:48');
    expect(result.current.b.text).toBe('0:52');
    advance(3000);
    const back = zhess.undo(g, 2);
    rerender({ game: back, tc: ONE_MIN, opts: {} });
    expect(result.current.w.text).toBe('1:00');
    expect(result.current.b.text).toBe('1:00');
    expect(result.current.elapsed()).toBe(0);
    rerender({ game: zhess.redo(back, 2), tc: ONE_MIN, opts: {} });
    expect(result.current.w.text).toBe('0:48');
    expect(result.current.b.text).toBe('0:52');
  });

  it('fires onFlag once when the side to move runs out', () => {
    const onFlag = vi.fn();
    const g = playAll([['g1f3', 55_000], ['b8c6', 0]], opened);
    const { result } = mount(g, ONE_MIN, { onFlag });
    advance(4900);
    expect(result.current.w.text).toBe('0.1');
    expect(result.current.w.low).toBe(true);
    expect(onFlag).not.toHaveBeenCalled();
    advance(200);
    expect(onFlag).toHaveBeenCalledTimes(1);
    expect(onFlag).toHaveBeenCalledWith('w');
    expect(result.current.w).toMatchObject({ text: '0.0', flagged: true });
    advance(1000);
    expect(onFlag).toHaveBeenCalledTimes(1);
  });

  it('does not flag while paused or before the side has moved', () => {
    const onFlag = vi.fn();
    const { rerender } = mount(zhess.newGame(), ONE_MIN, { onFlag });
    advance(120_000);
    expect(onFlag).not.toHaveBeenCalled();
    rerender({ game: opened, tc: ONE_MIN, opts: { onFlag, paused: true } });
    advance(120_000);
    expect(onFlag).not.toHaveBeenCalled();
  });

  it('a game lost on time shows 0.0 and stops', () => {
    const lost = zhess.timeout(opened, 'w');
    const { result } = mount(lost, ONE_MIN);
    expect(result.current.ticking).toBe(false);
    expect(result.current.w).toMatchObject({ text: '0.0', flagged: true });
    expect(result.current.flagged).toBe('w');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clock off: time used per side, dimmed, still measured', () => {
    const g = playAll([['g1f3', 4000]], opened);
    const { result } = mount(g, null);
    expect(result.current.timed).toBe(false);
    advance(2000);
    expect(result.current.b).toMatchObject({ text: '0:02', untimed: true, running: false });
    expect(result.current.w).toMatchObject({ text: '0:04', untimed: true });
    expect(result.current.elapsed()).toBe(2000);
  });

  it('a new session key starts a fresh turn; initialTurnMs restores one', () => {
    const { result, rerender } = mount(opened, ONE_MIN, { key: 'A', initialTurnMs: 9000 });
    expect(result.current.elapsed()).toBe(9000);
    expect(result.current.w.text).toBe('0:51');
    rerender({ game: opened, tc: ONE_MIN, opts: { key: 'B' } });
    expect(result.current.elapsed()).toBe(0);
  });

  it('without a game it shows the base time and does not tick', () => {
    const { result } = mount(null, '3+2');
    expect(result.current.w).toMatchObject({ text: '3:00', untimed: false });
    expect(result.current.ticking).toBe(false);
    expect(result.current.elapsed()).toBe(0);
  });

  describe('room (external turn, DESIGN 9.8)', () => {
    it('uses the controller stamps and gives the opponent 2 s of grace', () => {
      const onFlag = vi.fn();
      const g = playAll([['g1f3', 59_000], ['b8c6', 0]], opened); // white has 1 s left
      const ext = { turnStart: clock, turnUsed: 0 };
      const { result, rerender } = mount(g, ONE_MIN, { external: ext, ownColor: 'b', onFlag });
      advance(1000);
      expect(result.current.w.text).toBe('0.0');
      expect(onFlag).not.toHaveBeenCalled();
      advance(2100);
      expect(onFlag).toHaveBeenCalledWith('w');
      // Paused by a disconnect: the controller clears the stamp.
      onFlag.mockClear();
      rerender({ game: g, tc: ONE_MIN, opts: { external: { turnStart: null, turnUsed: 500 }, ownColor: 'b', onFlag } });
      expect(result.current.ticking).toBe(false);
      expect(result.current.elapsed()).toBe(500);
    });

    it("this device's own flag falls at zero", () => {
      const onFlag = vi.fn();
      const g = playAll([['g1f3', 59_000], ['b8c6', 0]], opened);
      mount(g, ONE_MIN, { external: { turnStart: clock, turnUsed: 0 }, ownColor: 'w', onFlag });
      advance(1100);
      expect(onFlag).toHaveBeenCalledWith('w');
    });
  });
});

/* ---------------------------------------------------------------------------------------------- */

interface PProps {
  game: Game | null;
  opts: UsePremoveOptions;
}

describe('usePremove', () => {
  const waiting = playAll([['e2e4', 0]]); // white (player) moved; black to move
  const base = (onFire = vi.fn(), player: Color = 'w'): UsePremoveOptions => ({ player, mode: 'computer', tc: '1+0', onFire });

  it('is off (no onPremove) without a clock or in pass-and-play', () => {
    const { result, rerender } = renderHook((p: PProps) => usePremove(p.game, p.opts), {
      initialProps: { game: waiting, opts: { ...base(), tc: null } as UsePremoveOptions },
    });
    expect(result.current.allowed).toBe(false);
    expect(result.current.onPremove).toBeUndefined();
    rerender({ game: waiting, opts: { ...base(), mode: 'local' } });
    expect(result.current.onPremove).toBeUndefined();
  });

  it('queues, then fires when the opponent has moved', () => {
    const onFire = vi.fn();
    const { result, rerender } = renderHook((p: PProps) => usePremove(p.game, p.opts), {
      initialProps: { game: waiting, opts: base(onFire) },
    });
    act(() => result.current.onPremove?.({ from: 'g1', to: 'f3' }));
    expect(result.current.premove).toEqual({ from: 'g1', to: 'f3' });
    rerender({ game: zhess.play(waiting, 'e7e5', 0), opts: base(onFire) });
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith('g1f3');
    expect(result.current.premove).toBeNull();
  });

  it('drops an illegal premove silently', () => {
    const onFire = vi.fn();
    const { result, rerender } = renderHook((p: PProps) => usePremove(p.game, p.opts), {
      initialProps: { game: waiting, opts: base(onFire) },
    });
    act(() => result.current.onPremove?.({ from: 'e4', to: 'e5' }));
    rerender({ game: zhess.play(waiting, 'e7e5', 0), opts: base(onFire) });
    expect(onFire).not.toHaveBeenCalled();
    expect(result.current.premove).toBeNull();
  });

  it('cancels on a tap (onPremove(null)) and via cancel()', () => {
    const onFire = vi.fn();
    const { result, rerender } = renderHook((p: PProps) => usePremove(p.game, p.opts), {
      initialProps: { game: waiting, opts: base(onFire) },
    });
    act(() => result.current.onPremove?.({ from: 'g1', to: 'f3' }));
    act(() => result.current.onPremove?.(null));
    expect(result.current.premove).toBeNull();
    act(() => result.current.onPremove?.({ from: 'g1', to: 'f3' }));
    act(() => result.current.cancel());
    rerender({ game: zhess.play(waiting, 'e7e5', 0), opts: base(onFire) });
    expect(onFire).not.toHaveBeenCalled();
  });

  it('ignores a premove on the own turn and drops on undo', () => {
    const onFire = vi.fn();
    const own = playAll([['e2e4', 0], ['e7e5', 0]]);
    const { result, rerender } = renderHook((p: PProps) => usePremove(p.game, p.opts), {
      initialProps: { game: own, opts: base(onFire) },
    });
    act(() => result.current.onPremove?.({ from: 'g1', to: 'f3' }));
    expect(result.current.premove).toBeNull();
    rerender({ game: waiting, opts: base(onFire) });
    act(() => result.current.onPremove?.({ from: 'g1', to: 'f3' }));
    expect(result.current.premove).not.toBeNull();
    rerender({ game: zhess.undo(waiting, 1), opts: base(onFire) });
    expect(result.current.premove).toBeNull();
    expect(onFire).not.toHaveBeenCalled();
  });
});
