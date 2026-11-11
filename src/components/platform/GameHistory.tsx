/**
 * "Previous games" below the fold of the start screen (DESIGN 12.2, Ztyle 10 / 11).
 *
 * The five most recent cards, then `N more games`, which opens the full-screen list of all
 * games grouped by Today / This week / This month / This year / Older. Deleting a card (swipe or
 * hover ×) calls `onDelete` at once and stacks an undo toast; Undo calls `onRestore`.
 * With no games (and no pending undo) nothing renders (Ztyle 09 "Empty states").
 *
 * Ported from Zudoku `GameHistory.tsx` with the audit fixes (#15 translated labels) and the
 * Zhess card. The thumbnail comes from the caller (`renderThumbnail`), since the board
 * thumbnail belongs to the board package.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import type { Room, SavedGame } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DeleteUndoToasts } from './DeleteUndoToasts';
import { GameCard, THUMBNAIL_SIZE, type RenderThumbnail } from './GameCard';
import { RECENT_GAMES, groupByTime, roomOf, sortByRecent, type HistoryGroup } from './history';
import { useUndoDeletions } from './useUndoDeletions';

export interface GameHistoryProps {
  /** Saved games, any order (`useSavedGames` / `Store.games()`). */
  games: readonly SavedGame[];
  /** Tap on a card: resume an unfinished game, open a finished one in review. */
  onOpen: (game: SavedGame) => void;
  /** Delete now (store and list state). An undo toast follows. */
  onDelete: (game: SavedGame) => void;
  /** Undo of a deletion: put the game back. */
  onRestore: (game: SavedGame) => void;
  /** Board thumbnail of the game's current position (`<BoardThumbnail>` from the board package). */
  renderThumbnail?: RenderThumbnail;
  /** Room records, for the score on room game cards. */
  rooms?: readonly Room[];
  /** Fades the section out (pointer-events off) while it is scrolled away, as in Zudoku. */
  isVisible?: boolean;
  /** Clock for relative times and grouping (tests). */
  now?: () => number;
  /** Thumbnail edge in px; default 96. */
  thumbnailSize?: number;
  className?: string;
}

const GROUP_KEYS: Record<HistoryGroup, TranslationKey> = {
  today: 'platform.history.today',
  thisWeek: 'platform.history.thisWeek',
  thisMonth: 'platform.history.thisMonth',
  thisYear: 'platform.history.thisYear',
  older: 'platform.history.older',
};

/** Re-renders every minute so relative times stay right. */
function useNow(now: () => number): number {
  const [value, setValue] = useState(now);
  useEffect(() => {
    const id = setInterval(() => setValue(now()), 60_000);
    return () => clearInterval(id);
  }, [now]);
  return value;
}

const systemNow = () => Date.now();

/** Subject of the undo toast: the code, plus the game number for room games. */
function deletionSubject(game: SavedGame): string {
  return game.room ? `${game.code} #${game.room.n}` : game.code;
}

export function GameHistory({
  games,
  onOpen,
  onDelete,
  onRestore,
  renderThumbnail,
  rooms,
  isVisible = true,
  now = systemNow,
  thumbnailSize = THUMBNAIL_SIZE,
  className,
}: GameHistoryProps) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const time = useNow(now);
  const undo = useUndoDeletions<SavedGame>(onRestore);
  const addDeletion = undo.add;

  const sorted = useMemo(() => sortByRecent(games), [games]);
  const recent = sorted.slice(0, RECENT_GAMES);
  const more = sorted.length - recent.length;

  const handleDelete = useCallback(
    (game: SavedGame) => {
      onDelete(game);
      addDeletion(game, deletionSubject(game));
    },
    [onDelete, addDeletion],
  );

  const handleOpen = useCallback(
    (game: SavedGame) => {
      setShowAll(false);
      onOpen(game);
    },
    [onOpen],
  );

  const closeAll = useCallback(() => {
    setShowAll(false);
    // Return focus to the button that opened the list (if it still exists).
    setTimeout(() => moreButton.current?.focus(), 0);
  }, []);

  if (games.length === 0 && undo.deletions.length === 0) return null;

  const card = (game: SavedGame) => (
    <GameCard
      key={game.id}
      game={game}
      room={roomOf(game, rooms)}
      now={time}
      onOpen={handleOpen}
      onDelete={handleDelete}
      renderThumbnail={renderThumbnail}
      thumbnailSize={thumbnailSize}
    />
  );

  return (
    <>
      {games.length > 0 && (
        <section
          aria-labelledby="zhess-history-title"
          className={cn(
            'w-full max-w-md mx-auto px-4 py-6 transition-opacity duration-300',
            isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
            className,
          )}
        >
          <h2
            id="zhess-history-title"
            className="flex items-center justify-center gap-2 mb-6 text-sm font-normal uppercase tracking-wider text-muted-foreground"
          >
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
            <span>{t('platform.history.title')}</span>
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          </h2>

          <ul className="space-y-2">{recent.map(card)}</ul>

          {more > 0 && (
            <button
              ref={moreButton}
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full mt-4 py-3 text-center text-sm font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg hover:border-foreground/30"
            >
              {more === 1 ? t('platform.history.oneMoreGame') : t('platform.history.moreGames', { count: more })}
            </button>
          )}
        </section>
      )}

      {showAll && typeof document !== 'undefined' &&
        createPortal(
          <FullGameList games={sorted} now={time} onClose={closeAll}>
            {(list) => list.map(card)}
          </FullGameList>,
          document.body,
        )}

      {typeof document !== 'undefined' &&
        createPortal(
          <DeleteUndoToasts
            deletions={undo.deletions}
            onUndo={undo.undo}
            onUndoAll={undo.undoAll}
            onDismiss={undo.dismiss}
            onExpire={undo.expire}
            className="z-[60]"
          />,
          document.body,
        )}
    </>
  );
}

interface FullGameListProps {
  games: SavedGame[];
  now: number;
  onClose: () => void;
  children: (games: SavedGame[]) => ReactNode;
}

/** Full-screen list of all games, grouped by time (Ztyle 10). Escape or ← closes it. */
function FullGameList({ games, now, onClose, children }: FullGameListProps) {
  const { t } = useI18n();
  const back = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => groupByTime(games, now), [games, now]);

  useEffect(() => {
    back.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Close when the last game is gone.
  useEffect(() => {
    if (games.length === 0) onClose();
  }, [games.length, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="zhess-all-games-title"
      className="fixed inset-0 z-50 bg-background overflow-y-auto overscroll-contain animate-fade-in"
    >
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-4 p-4 max-w-md mx-auto">
          <button ref={back} type="button" onClick={onClose} className="icon-button" aria-label={t('back')}>
            <ArrowLeft aria-hidden="true" />
          </button>
          <h2 id="zhess-all-games-title" className="font-mono text-lg font-normal uppercase tracking-wider">
            {t('platform.history.allGames')}
          </h2>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {groups.map(({ group, games: list }) => (
          <section key={group} className="mb-6">
            <h3 className="text-xs font-normal uppercase tracking-wider text-muted-foreground mb-3 px-1">
              {t(GROUP_KEYS[group])}
            </h3>
            <ul className="space-y-2">{children(list)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}
