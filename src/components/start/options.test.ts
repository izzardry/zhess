import { describe, expect, it } from 'vitest';
import type { Opponent, SavedGame, TimeControl } from '@/lib/types';
import {
  CLOCK_PRESETS,
  DEFAULT_OPPONENT,
  OPPONENTS,
  canStepOpponent,
  findGameForCode,
  isOpponent,
  isPresetClock,
  nextClock,
  nextColor,
  opponentIndex,
  opponentOfGame,
  sameClock,
  startLabel,
  stepOpponent,
} from './options';

const fmt = (t: TimeControl) => (t ? `${t.baseMs / 60000}+${t.incMs / 1000}` : 'off');

const saved = (over: Partial<SavedGame> = {}): SavedGame => ({
  id: 'K7QW2M',
  code: 'K7QW2M',
  mode: 'computer',
  level: 7,
  color: 'w',
  tc: null,
  moves: '',
  ms: [],
  assisted: false,
  createdAt: 1,
  lastPlayedAt: 1,
  ...over,
});

describe('opponent stepper values', () => {
  it('orders ROOM, TWO PLAYERS, COMPUTER 1 … 12', () => {
    expect(OPPONENTS).toHaveLength(14);
    expect(OPPONENTS[0]).toEqual({ mode: 'room' });
    expect(OPPONENTS[1]).toEqual({ mode: 'local' });
    expect(OPPONENTS[2]).toEqual({ mode: 'computer', level: 1 });
    expect(OPPONENTS[13]).toEqual({ mode: 'computer', level: 12 });
  });

  it('defaults to COMPUTER 5', () => {
    expect(DEFAULT_OPPONENT).toEqual({ mode: 'computer', level: 5 });
  });

  it('steps through every value forward and back without wrapping', () => {
    let o: Opponent = OPPONENTS[0];
    const seen = [opponentIndex(o)];
    while (canStepOpponent(o, 1)) {
      o = stepOpponent(o, 1);
      seen.push(opponentIndex(o));
    }
    expect(seen).toEqual(Array.from({ length: 14 }, (_, i) => i));
    expect(stepOpponent(o, 1)).toBe(o);
    expect(canStepOpponent(OPPONENTS[0], -1)).toBe(false);
    expect(stepOpponent(OPPONENTS[0], -1)).toBe(OPPONENTS[0]);
    expect(stepOpponent({ mode: 'computer', level: 1 }, -1)).toEqual({ mode: 'local' });
    expect(stepOpponent({ mode: 'local' }, -1)).toEqual({ mode: 'room' });
  });

  it('validates stored values', () => {
    expect(isOpponent({ mode: 'room' })).toBe(true);
    expect(isOpponent({ mode: 'computer', level: 12 })).toBe(true);
    expect(isOpponent({ mode: 'computer', level: 13 })).toBe(false);
    expect(isOpponent({ mode: 'computer', level: 2.5 })).toBe(false);
    expect(isOpponent({ mode: 'computer' })).toBe(false);
    expect(isOpponent('room')).toBe(false);
    expect(isOpponent(null)).toBe(false);
  });
});

describe('color pill cycle', () => {
  it('goes random → white → black → random', () => {
    expect(nextColor('random')).toBe('w');
    expect(nextColor('w')).toBe('b');
    expect(nextColor('b')).toBe('random');
  });
});

describe('clock pill cycle', () => {
  it('cycles off · 1+0 · 3+2 · 5+0 · 10+0 · 15+10 · 30+0 and back to off', () => {
    const seen: string[] = [];
    let t: TimeControl = null;
    for (let i = 0; i < 8; i++) {
      seen.push(fmt(t));
      t = nextClock(t);
    }
    expect(seen).toEqual(['off', '1+0', '3+2', '5+0', '10+0', '15+10', '30+0', 'off']);
    expect(CLOCK_PRESETS).toHaveLength(7);
  });

  it('moves a custom value to the next longer preset, or off', () => {
    expect(isPresetClock({ baseMs: 7 * 60000, incMs: 5000 })).toBe(false);
    expect(fmt(nextClock({ baseMs: 7 * 60000, incMs: 5000 }))).toBe('10+0');
    expect(fmt(nextClock({ baseMs: 15 * 60000, incMs: 5000 }))).toBe('15+10');
    expect(fmt(nextClock({ baseMs: 60 * 60000, incMs: 0 }))).toBe('off');
  });

  it('compares time controls by value', () => {
    expect(sameClock(null, null)).toBe(true);
    expect(sameClock({ baseMs: 1, incMs: 0 }, { baseMs: 1, incMs: 0 })).toBe(true);
    expect(sameClock({ baseMs: 1, incMs: 0 }, null)).toBe(false);
  });
});

describe('start pill label (DESIGN 4.1)', () => {
  const games = [
    saved({ id: 'NEWONE', code: 'NEWONE' }),
    saved({ id: 'DONE', code: 'DONE', result: '1-0', by: 'mate' }),
    saved({ id: 'ROOMX.1', code: 'ROOMX', mode: 'room' }),
  ];

  it('finds solo games by code, never room games', () => {
    expect(findGameForCode(games, 'NEWONE')?.id).toBe('NEWONE');
    expect(findGameForCode(games, 'ROOMX')).toBeUndefined();
    expect(findGameForCode(games, '')).toBeUndefined();
    expect(findGameForCode(games, 'NOPE')).toBeUndefined();
  });

  it('is START for a new code, RESUME for unfinished, REVIEW for finished', () => {
    const cpu: Opponent = { mode: 'computer', level: 5 };
    expect(startLabel(cpu, undefined)).toBe('start');
    expect(startLabel(cpu, findGameForCode(games, 'NEWONE'))).toBe('resume');
    expect(startLabel(cpu, findGameForCode(games, 'DONE'))).toBe('review');
  });

  it('is always START for a room', () => {
    expect(startLabel({ mode: 'room' }, findGameForCode(games, 'NEWONE'))).toBe('start');
    expect(startLabel({ mode: 'room' }, undefined)).toBe('start');
  });

  it('maps a saved game back to its opponent', () => {
    expect(opponentOfGame(saved({ mode: 'computer', level: 7 }))).toEqual({ mode: 'computer', level: 7 });
    expect(opponentOfGame(saved({ mode: 'local', level: undefined }))).toEqual({ mode: 'local' });
    expect(opponentOfGame(saved({ mode: 'room' }))).toEqual({ mode: 'room' });
    expect(opponentOfGame(saved({ mode: 'computer', level: undefined }))).toEqual({ mode: 'computer', level: 5 });
  });
});
