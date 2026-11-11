/**
 * Stored games for the history list (DESIGN 12.2, Ztyle chapter 11, Zudoku GameHistory).
 *
 * Reads `zhess:games` through the store, stays current when `useGameState` saves (in-app
 * notification) or another tab writes (`storage` event), and deletes with a restore path for the
 * undo toast. Grouping by time follows Zudoku: the full list groups the games after the five
 * most recent cards.
 *
 * Rooms (DESIGN 9.5, 12.2): `rooms` holds the room records (game number and score on the cards).
 * Deleting a room game removes the local room record as well; its undo puts the record back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RECENT_COUNT,
  groupByTime,
  notifySavedGames,
  onSavedGamesChange,
  type TimeGroup,
} from '@/lib/gameRecord';
import { store as defaultStore } from '@/lib/storage';
import type { Now, Room, SavedGame, Store } from '@/lib/types';

export type { TimeGroup, TimeGroupKey } from '@/lib/gameRecord';

export interface UseSavedGamesOptions {
  store?: Store;
  /** Clock for the time groups; defaults to `Date.now`. */
  now?: Now;
}

export interface UseSavedGames {
  /** All stored games, newest `lastPlayedAt` first (at most 100). */
  games: SavedGame[];
  /** Room records (`zhess:rooms`), for the room score on room game cards. */
  rooms: Room[];
  /** The five most recent: the cards below the fold. */
  recent: SavedGame[];
  /** The games after those five (the `N more games` count is `rest.length`). */
  rest: SavedGame[];
  /** `rest` grouped by time (today, week, month, year, older), empty groups dropped, as in Zudoku. */
  groups: TimeGroup[];
  /** Re-reads the store. */
  refresh(): void;
  /**
   * Deletes a game at once and returns it for the undo toast (undefined if it was not stored).
   * A room game takes its local room record with it (DESIGN 9.5).
   */
  remove(id: string): SavedGame | undefined;
  /**
   * Puts deleted games back (undo toast; `Undo all` passes several). Their place follows
   * `lastPlayedAt`. A room game's record comes back too, unless the code holds a room again.
   */
  restore(games: SavedGame | readonly SavedGame[]): void;
}

export function useSavedGames(options: UseSavedGamesOptions = {}): UseSavedGames {
  const store = options.store ?? defaultStore;
  const nowOpt = options.now;
  const [games, setGames] = useState<SavedGame[]>(() => store.games());
  const [rooms, setRooms] = useState<Room[]>(() => store.rooms());
  /** Room records removed with a game, by that game's id, for its undo. */
  const removedRooms = useRef(new Map<string, Room>());

  const refresh = useCallback(() => {
    setGames(store.games());
    setRooms(store.rooms());
  }, [store]);

  useEffect(() => {
    refresh();
    const off = onSavedGamesChange(refresh);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'zhess:games' || e.key === 'zhess:rooms') refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      off();
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  const remove = useCallback(
    (id: string) => {
      const removed = store.deleteGame(id);
      if (removed?.mode === 'room') {
        const room = store.deleteRoom(removed.code);
        if (room) removedRooms.current.set(removed.id, room);
      }
      notifySavedGames();
      return removed;
    },
    [store],
  );

  const restore = useCallback(
    (g: SavedGame | readonly SavedGame[]) => {
      const list: readonly SavedGame[] = Array.isArray(g) ? g : [g as SavedGame];
      for (const x of list) {
        store.restoreGame(x);
        const room = removedRooms.current.get(x.id);
        if (!room) continue;
        removedRooms.current.delete(x.id);
        // A room started again under this code since the delete keeps its own record.
        if (!store.rooms().some((r) => r.code === room.code)) store.saveRoom(room);
      }
      notifySavedGames();
    },
    [store],
  );

  const recent = useMemo(() => games.slice(0, RECENT_COUNT), [games]);
  const rest = useMemo(() => games.slice(RECENT_COUNT), [games]);
  const groups = useMemo(() => groupByTime(rest, nowOpt ? nowOpt() : Date.now()), [rest, nowOpt]);

  return { games, rooms, recent, rest, groups, refresh, remove, restore };
}

export default useSavedGames;
