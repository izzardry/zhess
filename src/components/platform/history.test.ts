import { describe, expect, it } from 'vitest';
import {
  cardState,
  formatPoints,
  formatRelativeTime,
  formatRoomScore,
  groupByTime,
  groupOf,
  moveCount,
  plyCount,
  roomOf,
  sideToMove,
  sortByRecent,
} from './history';
import { savedGame } from './test-utils';
import type { Room } from '@/lib/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A fixed local "now": 2026-11-11 15:00 local time.
const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime();

describe('grouping', () => {
  it('puts times into Today / This week / This month / This year / Older', () => {
    expect(groupOf(NOW, NOW)).toBe('today');
    expect(groupOf(new Date(2026, 10, 11, 0, 0, 1).getTime(), NOW)).toBe('today');
    expect(groupOf(new Date(2026, 10, 10, 23, 59).getTime(), NOW)).toBe('thisWeek');
    expect(groupOf(NOW - 10 * DAY, NOW)).toBe('thisMonth');
    expect(groupOf(NOW - 100 * DAY, NOW)).toBe('thisYear');
    expect(groupOf(NOW - 400 * DAY, NOW)).toBe('older');
  });

  it('returns only non-empty groups, newest first inside each', () => {
    const games = [
      savedGame({ id: 'a', lastPlayedAt: NOW - 400 * DAY }),
      savedGame({ id: 'b', lastPlayedAt: NOW - HOUR }),
      savedGame({ id: 'c', lastPlayedAt: NOW - 2 * HOUR }),
      savedGame({ id: 'd', lastPlayedAt: NOW - 3 * DAY }),
    ];
    const groups = groupByTime(games, NOW);
    expect(groups.map((g) => g.group)).toEqual(['today', 'thisWeek', 'older']);
    expect(groups[0].games.map((g) => g.id)).toEqual(['b', 'c']);
  });

  it('sorts newest first without mutating', () => {
    const games = [savedGame({ id: 'x', lastPlayedAt: 1 }), savedGame({ id: 'y', lastPlayedAt: 2 })];
    expect(sortByRecent(games).map((g) => g.id)).toEqual(['y', 'x']);
    expect(games[0].id).toBe('x');
  });
});

describe('card facts', () => {
  it('counts plies and full moves', () => {
    const g = savedGame({ uci: ['e2e4', 'e7e5', 'g1f3'] });
    expect(plyCount(g)).toBe(3);
    expect(moveCount(3)).toBe(2);
    expect(moveCount(0)).toBe(0);
    expect(plyCount(savedGame())).toBe(0);
  });

  it('falls back to ms length for an unreadable move string', () => {
    expect(plyCount(savedGame({ moves: '!!', ms: [1, 2, 3] }))).toBe(3);
  });

  it('knows the side to move from the ply count', () => {
    expect(sideToMove(0)).toBe('w');
    expect(sideToMove(1)).toBe('b');
  });

  it('says Your move / Their move for computer and room games', () => {
    expect(cardState(savedGame({ color: 'w' }))).toEqual({ kind: 'yourMove' });
    expect(cardState(savedGame({ color: 'b' }))).toEqual({ kind: 'theirMove' });
    expect(cardState(savedGame({ color: 'b', uci: ['e2e4'], mode: 'room' }))).toEqual({ kind: 'yourMove' });
  });

  it('says whose turn by color in pass-and-play', () => {
    expect(cardState(savedGame({ mode: 'local', uci: ['e2e4'] }))).toEqual({ kind: 'toMove', color: 'b' });
  });

  it('says Won / Lost / Draw from this device side, and 1–0 in pass-and-play', () => {
    expect(cardState(savedGame({ result: '1-0', color: 'w' }))).toEqual({ kind: 'won' });
    expect(cardState(savedGame({ result: '1-0', color: 'b' }))).toEqual({ kind: 'lost' });
    expect(cardState(savedGame({ result: '1/2-1/2' }))).toEqual({ kind: 'draw' });
    expect(cardState(savedGame({ result: '0-1', mode: 'local' }))).toEqual({ kind: 'result', text: '0–1' });
    expect(cardState(savedGame({ result: '1/2-1/2', mode: 'local' }))).toEqual({ kind: 'draw' });
  });
});

describe('room score', () => {
  it('formats half points', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(1)).toBe('½');
    expect(formatPoints(4)).toBe('2');
    expect(formatPoints(5)).toBe('2½');
  });

  it('puts this device seat first', () => {
    expect(formatRoomScore({ score: [4, 2], seat: 0 })).toBe('2 – 1');
    expect(formatRoomScore({ score: [4, 3], seat: 1 })).toBe('1½ – 2');
  });

  it('finds the room of a room game', () => {
    const room: Room = { code: 'ABC', key: 'k', seat: 0, createdAt: 0, lastSeenAt: 0, score: [0, 0], games: ['ABC.1'] };
    expect(roomOf(savedGame({ id: 'ABC.1', code: 'ABC', mode: 'room' }), [room])).toBe(room);
    expect(roomOf(savedGame({ code: 'ABC', mode: 'local' }), [room])).toBeUndefined();
    expect(roomOf(savedGame({ code: 'XYZ', id: 'XYZ.1', mode: 'room' }), [room])).toBeUndefined();
  });
});

describe('relative time', () => {
  it('uses the UI language', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW, 'en')).toBe('now');
    expect(formatRelativeTime(NOW - 5 * MIN, NOW, 'en')).toMatch(/5 min/);
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW, 'en')).toMatch(/3 hr/);
    expect(formatRelativeTime(NOW - DAY, NOW, 'en')).toBe('yesterday');
    expect(formatRelativeTime(NOW - DAY, NOW, 'de')).toBe('gestern');
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, 'en')).toMatch(/3 days ago/);
  });

  it('shows a date from a week back, with the year when it differs', () => {
    expect(formatRelativeTime(new Date(2026, 10, 1, 12).getTime(), NOW, 'en')).toBe('Nov 1');
    expect(formatRelativeTime(new Date(2025, 0, 2, 12).getTime(), NOW, 'en')).toBe('Jan 2, 2025');
  });

  it('never shows the future', () => {
    expect(formatRelativeTime(NOW + HOUR, NOW, 'en')).toBe('now');
  });
});
