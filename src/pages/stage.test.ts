import { describe, expect, it } from 'vitest';
import zhess from '@/lib/zhess';
import type { Game } from '@/lib/types';
import { createSession } from '@/lib/gameRecord';
import { allSan, baseOrientation, canContinueFrom, other, pgnMeta, PLAYABLE_MODES, stripClock, totalTime } from './stage';

function playAll(ucis: string[], ms = 1000): Game {
  let g = zhess.newGame();
  for (const m of ucis) g = zhess.play(g, m, ms);
  return g;
}

const MATE = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];

describe('stage helpers', () => {
  it('only pass-and-play is playable in milestone 1', () => {
    expect(PLAYABLE_MODES).toEqual({ local: true, computer: false, room: false });
  });

  it('orients white at the bottom in pass-and-play, else the player side', () => {
    expect(baseOrientation({ mode: 'local', color: 'b' })).toBe('w');
    expect(baseOrientation({ mode: 'computer', color: 'b' })).toBe('b');
    expect(other('w')).toBe('b');
    expect(other('b')).toBe('w');
  });

  it('lists the SAN of the redo tail too', () => {
    const g = zhess.undo(playAll(['e2e4', 'e7e5', 'g1f3']), 2);
    expect(zhess.san(g)).toEqual(['e4']);
    expect(allSan(g)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('sums the time used up to the cursor', () => {
    const g = playAll(['e2e4', 'e7e5', 'g1f3'], 1500);
    expect(totalTime(g)).toBe(4500);
    expect(totalTime(zhess.undo(g, 1))).toBe(3000);
  });

  it('allows continuing from a review position but not from mate', () => {
    const mated = playAll(MATE);
    expect(mated.end?.by).toBe('mate');
    expect(canContinueFrom(mated)).toBe(false);
    // The review view keeps the game's end; one ply back is still a live position.
    const back = zhess.goto(mated, 6);
    expect(back.end).toBeDefined();
    expect(canContinueFrom(back)).toBe(true);
    expect(canContinueFrom(playAll(['e2e4']))).toBe(true);
  });

  it('shows time used, dimmed, without a clock', () => {
    const g = playAll(['e2e4', 'e7e5', 'g1f3'], 61_000);
    expect(stripClock(g, null, 'w', false, 0)).toMatchObject({ text: '2:02', untimed: true, running: false });
    // Black is to move: the live turn adds to black's time.
    expect(stripClock(g, null, 'b', true, 5_000).text).toBe('1:06');
    expect(stripClock(g, null, 'w', true, 5_000).text).toBe('2:02');
  });

  it('counts the clock of the side to move down once both sides have moved', () => {
    const one = playAll(['e2e4'], 3000);
    // Black has not moved yet: the first move starts the clock (DESIGN 9.8).
    expect(stripClock(one, '1+0', 'b', true, 5_000)).toMatchObject({ text: '1:00', running: false, untimed: false });
    const g = playAll(['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2000);
    expect(stripClock(g, '1+0', 'w', true, 55_500)).toMatchObject({ text: '2.5', running: true, low: true, flagged: false });
    expect(stripClock(g, '1+0', 'w', true, 70_000)).toMatchObject({ text: '0.0', flagged: true });
    expect(stripClock(g, '1+0', 'b', true, 70_000)).toMatchObject({ text: '0:58', running: false });
  });

  it('writes English PGN headers', () => {
    const s = createSession({ code: 'K7QW2M', mode: 'local', color: 'w', tc: '5+0' }, Date.UTC(2026, 10, 11, 12));
    const meta = pgnMeta(s, 'https://example.test/');
    expect(meta).toMatchObject({ event: 'Zhess K7QW2M', site: 'https://example.test/', white: 'White', black: 'Black' });
    expect(meta.date).toMatch(/^2026\.11\.1[01]$/);
    expect(meta.timeControl).toEqual({ baseMs: 300_000, incMs: 0 });
    const c = createSession({ code: 'ABC', mode: 'computer', level: 7, color: 'b', tc: null }, 0);
    expect(pgnMeta(c, '')).toMatchObject({ white: 'Zhess Level 7', black: 'Player', timeControl: null });
  });
});
