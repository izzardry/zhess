import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, memoryStorage } from '@/lib/storage';
import type { SavedGame, Store } from '@/lib/types';
import { useGameState } from './useGameState';
import { useSavedGames } from './useSavedGames';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 11, 12, 0, 0).getTime();
let store: Store;

function game(id: string, lastPlayedAt: number, extra: Partial<SavedGame> = {}): SavedGame {
  return {
    id,
    code: id,
    mode: 'local',
    color: 'w',
    tc: null,
    moves: '',
    ms: [],
    assisted: false,
    createdAt: lastPlayedAt,
    lastPlayedAt,
    ...extra,
  };
}

beforeEach(() => {
  store = createStore(memoryStorage());
});

describe('useSavedGames', () => {
  it('lists newest first with five recent cards and the rest grouped by time', () => {
    const ids = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];
    // G1 newest … G8 oldest; G6 today, G7 three days ago, G8 a year and more ago.
    const ages = [1, 2, 3, 4, 5, 6, 3 * DAY, 400 * DAY];
    ids.forEach((id, i) => store.saveGame(game(id, NOW - ages[i] * (i < 6 ? 60_000 : 1))));
    const { result } = renderHook(() => useSavedGames({ store, now: () => NOW }));
    expect(result.current.games.map((g) => g.id)).toEqual(ids);
    expect(result.current.recent.map((g) => g.id)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    expect(result.current.rest.map((g) => g.id)).toEqual(['G6', 'G7', 'G8']);
    expect(result.current.groups.map((g) => [g.key, g.games.map((x) => x.id)])).toEqual([
      ['today', ['G6']],
      ['week', ['G7']],
      ['older', ['G8']],
    ]);
  });

  it('deletes with a restore path for the undo toast', () => {
    store.saveGame(game('A', NOW - 1000));
    store.saveGame(game('B', NOW - 2000));
    store.saveGame(game('C', NOW - 3000));
    const { result } = renderHook(() => useSavedGames({ store, now: () => NOW }));
    let a: SavedGame | undefined;
    let c: SavedGame | undefined;
    act(() => {
      a = result.current.remove('A');
      c = result.current.remove('C');
    });
    expect(a?.id).toBe('A');
    expect(result.current.games.map((g) => g.id)).toEqual(['B']);
    expect(store.games().map((g) => g.id)).toEqual(['B']);
    act(() => {
      expect(result.current.remove('nope')).toBeUndefined();
    });
    act(() => result.current.restore([a!, c!]));
    expect(result.current.games.map((g) => g.id)).toEqual(['A', 'B', 'C']);
  });

  it('follows saves made by useGameState', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: ['/?s=LIVE01&o=l'] }, children);
    const { result } = renderHook(
      () => ({ list: useSavedGames({ store }), gs: useGameState({ store, now: () => NOW }) }),
      { wrapper },
    );
    expect(result.current.list.games).toHaveLength(0);
    act(() => void result.current.gs.start());
    expect(result.current.list.games.map((g) => g.id)).toEqual(['LIVE01']);
    act(() => void result.current.gs.move('e2e4', 5));
    expect(result.current.list.games[0].ms).toEqual([5]);

    // Deleting from the list updates the Start pill of the game state.
    act(() => result.current.gs.exit());
    expect(result.current.gs.startPill.label).toBe('resume');
    act(() => void result.current.list.remove('LIVE01'));
    expect(result.current.gs.startPill.label).toBe('start');
  });

  it('refreshes on storage events from other tabs', () => {
    const { result } = renderHook(() => useSavedGames({ store }));
    store.saveGame(game('OTHER', NOW));
    expect(result.current.games).toHaveLength(0);
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'zhess:games' })));
    expect(result.current.games.map((g) => g.id)).toEqual(['OTHER']);
  });
});
