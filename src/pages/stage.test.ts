import { describe, expect, it } from 'vitest';
import zhess from '@/lib/zhess';
import type { Game } from '@/lib/types';
import { createSession } from '@/lib/gameRecord';
import { allSan, baseOrientation, canContinueFrom, other, pgnMeta, PLAYABLE_MODES, reviewClockView, totalTime } from './stage';

function playAll(ucis: string[], ms = 1000): Game {
  let g = zhess.newGame();
  for (const m of ucis) g = zhess.play(g, m, ms);
  return g;
}

const MATE = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'];

describe('stage helpers', () => {
  it('pass-and-play and the computer are playable in milestone 2', () => {
    expect(PLAYABLE_MODES).toEqual({ local: true, computer: true, room: false });
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

  it('review shows time used, dimmed, without a clock', () => {
    const g = playAll(['e2e4', 'e7e5', 'g1f3'], 61_000);
    expect(reviewClockView(g, null).w).toMatchObject({ text: '2:02', untimed: true, running: false });
    expect(reviewClockView(g, null).b.text).toBe('1:01');
  });

  it('review shows the clocks as they stood at the shown move, never running', () => {
    const g = playAll(['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2000);
    // Each side's first move is untimed: white used 2 s once (g1f3), black once (b8c6).
    const v = reviewClockView(g, '1+0');
    expect(v.w).toMatchObject({ text: '0:58', running: false, untimed: false, flagged: false });
    expect(v.b).toMatchObject({ text: '0:58', running: false });
    expect(reviewClockView(zhess.goto(g, 2), '1+0').w.text).toBe('1:00');
  });

  it('review of a game lost on time shows 0.0 only at the end', () => {
    const g = playAll(['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2000);
    const lost = zhess.timeout(g, 'w');
    expect(reviewClockView(lost, '1+0').w).toMatchObject({ text: '0.0', flagged: true });
    const earlier = zhess.goto(lost, 2);
    expect(earlier.end).toBeDefined();
    expect(reviewClockView(earlier, '1+0').w).toMatchObject({ text: '1:00', flagged: false });
    expect(reviewClockView(earlier, '1+0').b.flagged).toBe(false);
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
