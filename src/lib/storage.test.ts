import { describe, expect, it } from 'vitest';
import { MAX_GAMES, PREFIX, createStore, memoryStorage, store as defaultStore } from './storage';
import type { Room, SavedGame } from './types';

function game(id: string, lastPlayedAt: number, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    id,
    code: id.split('.')[0],
    mode: 'local',
    color: 'w',
    tc: null,
    moves: 'Mc',
    ms: [1000],
    assisted: false,
    createdAt: lastPlayedAt,
    lastPlayedAt,
    ...extra,
  };
}

function room(code: string): Room {
  return { code, key: 'k3y', seat: 0, createdAt: 1, lastSeenAt: 1, score: [0, 0], games: [] };
}

describe('storage', () => {
  it('uses the zhess: prefix and JSON values', () => {
    const mem = memoryStorage();
    const s = createStore(mem);
    s.saveGame(game('K7QW2M', 5));
    s.setPref('helpers', false);
    s.setPref('color', 'random');
    const dump = mem.dump();
    expect(Object.keys(dump).sort()).toEqual([`${PREFIX}color`, `${PREFIX}games`, `${PREFIX}helpers`]);
    expect(dump['zhess:helpers']).toBe('false');
    expect(dump['zhess:color']).toBe('"random"');
    expect(JSON.parse(dump['zhess:games'])[0].id).toBe('K7QW2M');
  });

  it('keeps games newest first, upserts by id, and caps at 100', () => {
    const s = createStore(memoryStorage());
    s.saveGame(game('A', 1));
    s.saveGame(game('B', 3));
    s.saveGame(game('C', 2));
    expect(s.games().map((g) => g.id)).toEqual(['B', 'C', 'A']);
    s.saveGame(game('A', 4, { moves: 'McUk' }));
    expect(s.games().map((g) => g.id)).toEqual(['A', 'B', 'C']);
    expect(s.games()[0].moves).toBe('McUk');
    // Saving without bumping lastPlayedAt (the 15 s rule) does not reorder.
    s.saveGame(game('C', 2, { moves: 'Mc' }));
    expect(s.games().map((g) => g.id)).toEqual(['A', 'B', 'C']);
    for (let i = 0; i < 120; i++) s.saveGame(game(`G${i}`, 100 + i));
    const all = s.games();
    expect(all).toHaveLength(MAX_GAMES);
    expect(all[0].id).toBe('G119');
    expect(all.some((g) => g.id === 'A')).toBe(false);
  });

  it('deletes and restores games for the undo toast', () => {
    const s = createStore(memoryStorage());
    s.saveGame(game('A', 1));
    s.saveGame(game('B', 2));
    const removed = s.deleteGame('A');
    expect(removed?.id).toBe('A');
    expect(s.games().map((g) => g.id)).toEqual(['B']);
    expect(s.deleteGame('nope')).toBeUndefined();
    s.restoreGame(removed!);
    expect(s.games().map((g) => g.id)).toEqual(['B', 'A']);
  });

  it('stores room games by their own id', () => {
    const s = createStore(memoryStorage());
    s.saveGame(game('K7QW2M.1', 1, { mode: 'room', room: { n: 1, epoch: 0 } }));
    s.saveGame(game('K7QW2M.2', 2, { mode: 'room', room: { n: 2, epoch: 1 } }));
    expect(s.games().map((g) => g.id)).toEqual(['K7QW2M.2', 'K7QW2M.1']);
  });

  it('upserts, lists and deletes rooms', () => {
    const s = createStore(memoryStorage());
    s.saveRoom(room('AAAAAA'));
    s.saveRoom(room('BBBBBB'));
    s.saveRoom({ ...room('AAAAAA'), score: [2, 0], games: ['AAAAAA.1'] });
    expect(s.rooms()).toHaveLength(2);
    expect(s.rooms().find((r) => r.code === 'AAAAAA')?.score).toEqual([2, 0]);
    expect(s.deleteRoom('AAAAAA')?.games).toEqual(['AAAAAA.1']);
    expect(s.deleteRoom('AAAAAA')).toBeUndefined();
    expect(s.rooms().map((r) => r.code)).toEqual(['BBBBBB']);
  });

  it('reads preferences with fallbacks', () => {
    const mem = memoryStorage({
      'zhess:lang': 'de',
      'zhess:clock': '"5+0"',
      'zhess:helpers': 'true',
      'zhess:seating': '42',
      'zhess:opponent': '{"mode":"computer","level":7}',
    });
    const s = createStore(mem);
    expect(s.pref('lang', 'en')).toBe('de'); // bare string written by hand or older code
    expect(s.pref('clock', 'off')).toBe('5+0');
    expect(s.pref('helpers', false)).toBe(true);
    expect(s.pref('seating', 'face')).toBe('face'); // wrong type → fallback
    expect(s.pref('opponent', { mode: 'computer', level: 5 })).toEqual({ mode: 'computer', level: 7 });
    expect(s.pref('missing', 3)).toBe(3);
    expect(s.pref<string | null>('lang', null)).toBe(null); // not JSON and fallback not a string
    s.setPref('tutorial-seen', true);
    expect(s.pref('tutorial-seen', false)).toBe(true);
    s.setPref('tutorial-seen', undefined);
    expect(mem.getItem('zhess:tutorial-seen')).toBeNull();
  });

  it('survives corrupt data', () => {
    const s = createStore(
      memoryStorage({
        'zhess:games': '{not json',
        'zhess:rooms': '{"code":"X"}',
      }),
    );
    expect(s.games()).toEqual([]);
    expect(s.rooms()).toEqual([]);
    const mixed = createStore(
      memoryStorage({
        'zhess:games': JSON.stringify([game('OK', 1), { id: 'broken' }, null, 7]),
        'zhess:rooms': JSON.stringify([room('R1'), { code: 'R2' }]),
      }),
    );
    expect(mixed.games().map((g) => g.id)).toEqual(['OK']);
    expect(mixed.rooms().map((r) => r.code)).toEqual(['R1']);
  });

  it('never throws when storage is missing or throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    for (const source of [throwing, null, () => throwing, () => { throw new Error('denied'); }]) {
      const s = createStore(source);
      expect(s.games()).toEqual([]);
      expect(s.rooms()).toEqual([]);
      expect(() => s.saveGame(game('A', 1))).not.toThrow();
      expect(() => s.saveRoom(room('A'))).not.toThrow();
      expect(s.deleteGame('A')).toBeUndefined();
      expect(s.deleteRoom('A')).toBeUndefined();
      expect(() => s.restoreGame(game('A', 1))).not.toThrow();
      expect(s.pref('helpers', true)).toBe(true);
      expect(() => s.setPref('helpers', false)).not.toThrow();
      expect(() => s.setPref('helpers', undefined)).not.toThrow();
    }
  });

  it('the default store works over localStorage', () => {
    // Node 26 defines its own global localStorage getter (undefined without --localstorage-file),
    // which shadows jsdom's in Vitest. Install a memory storage for this test and put the original back.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const mem = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
    try {
      defaultStore.setPref('color', 'b');
      expect(mem.getItem('zhess:color')).toBe('"b"');
      expect(defaultStore.pref('color', 'random')).toBe('b');
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
