/**
 * One history card (DESIGN 12.2, Ztyle 10 "List card").
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ [thumb]  K7QW2M  Game 3  2 – 1      5 min ago │
 *   │          LEVEL 5 MEDIUM                       │
 *   │          Your move            23 moves · 5+0 ○│
 *   └───────────────────────────────────────────────┘
 *
 * Tap opens the game (resume or review: the caller decides). Swipe left (touch) or the hover ×
 * (mouse; also reachable by keyboard focus, or the Delete key on the card) deletes with a
 * height collapse.
 */
import { memo, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { levelKey, useI18n } from '@/lib/i18n';
import type { Room, SavedGame } from '@/lib/types';
import { cn } from '@/lib/utils';
import { cardState, formatRelativeTime, formatRoomScore, moveCount, plyCount, type CardState } from './history';
import { useSwipeToDelete } from './useSwipeToDelete';

/** Thumbnail edge in px handed to `renderThumbnail`. */
export const THUMBNAIL_SIZE = 96;

export type RenderThumbnail = (game: SavedGame, size: number) => ReactNode;

export interface GameCardProps {
  game: SavedGame;
  /** The game's room record, for the room score. */
  room?: Room;
  /** Current time for the relative time. */
  now: number;
  onOpen: (game: SavedGame) => void;
  /** Called after the collapse animation. */
  onDelete: (game: SavedGame) => void;
  renderThumbnail?: RenderThumbnail;
  thumbnailSize?: number;
}

function GameCardImpl({ game, room, now, onOpen, onDelete, renderThumbnail, thumbnailSize = THUMBNAIL_SIZE }: GameCardProps) {
  const { t, language } = useI18n();
  const { elRef, wrapperRef, handlers, collapse, consumeSwipeClick } = useSwipeToDelete<HTMLLIElement>(() => onDelete(game));

  const plies = plyCount(game);
  const moves = moveCount(plies);
  const state = cardState(game, plies);

  const opponent =
    game.mode === 'computer'
      ? t('platform.history.level', { level: game.level ?? 5, name: t(levelKey(game.level ?? 5)) })
      : game.mode === 'local'
        ? t('twoPlayers')
        : t('room');

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      collapse();
    }
  };

  return (
    <li ref={wrapperRef} className="list-none">
      <div ref={elRef} className="group relative touch-pan-y select-none" {...handlers}>
        <button
          type="button"
          onClick={() => {
            if (consumeSwipeClick()) return;
            onOpen(game);
          }}
          onKeyDown={onKeyDown}
          className="list-card w-full text-left"
          data-testid="history-card"
        >
          <div className="flex gap-4 items-center">
            {renderThumbnail && (
              <div className="shrink-0" style={{ width: thumbnailSize, height: thumbnailSize }} aria-hidden="true">
                {renderThumbnail(game, thumbnailSize)}
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1.5">
              {/* The code never shrinks (DESIGN 12.2); the time wraps under it on a narrow card. */}
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-lg tracking-wider whitespace-nowrap shrink-0" data-part="code">
                  {game.code}
                </span>
                <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap" data-part="time">
                  {formatRelativeTime(game.lastPlayedAt, now, language)}
                </span>
              </div>
              {/* Room cards: the game number and the room score share the opponent line and wrap as whole parts. */}
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="min-w-0 truncate uppercase tracking-wider text-muted-foreground">{opponent}</span>
                {game.room && (
                  <span className="text-muted-foreground whitespace-nowrap" data-part="game-number">
                    {t('platform.history.gameNumber', { n: game.room.n })}
                  </span>
                )}
                {room && (
                  <span className="ml-auto font-mono whitespace-nowrap" data-part="room-score">
                    {formatRoomScore(room)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <StateLabel state={state} />
                <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {moves > 0 && (
                    <span>{moves === 1 ? t('platform.history.oneMove') : t('platform.history.moves', { count: moves })}</span>
                  )}
                  {game.tc && <span>{game.tc}</span>}
                  {game.assisted && (
                    <span
                      role="img"
                      aria-label={t('platform.history.assisted')}
                      title={t('platform.history.assisted')}
                      className="inline-block w-2 h-2 rounded-full border border-muted-foreground"
                    />
                  )}
                </span>
              </div>
            </div>
          </div>
        </button>

        {/* Hover × (Ztyle 08): hidden on touch-only devices, which swipe instead. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            collapse();
          }}
          aria-label={t('platform.history.delete', { code: game.code })}
          className={cn(
            'absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center',
            'bg-card border border-border shadow-sm text-muted-foreground',
            'hover:text-destructive hover:border-destructive/50 transition-all duration-150',
            'opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100',
            'focus-visible:opacity-100 focus-visible:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100',
            '[@media(hover:none)]:hidden',
          )}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function StateLabel({ state }: { state: CardState }) {
  const { t } = useI18n();
  switch (state.kind) {
    case 'yourMove':
      return <span className="text-xs font-medium">{t('platform.history.yourMove')}</span>;
    case 'theirMove':
      return <span className="text-xs text-muted-foreground">{t('platform.history.theirMove')}</span>;
    case 'toMove':
      return (
        <span className="text-xs">
          {state.color === 'w' ? t('platform.history.whiteToMove') : t('platform.history.blackToMove')}
        </span>
      );
    case 'won':
      return <span className="text-xs font-medium text-success">{t('platform.history.won')}</span>;
    case 'lost':
      return <span className="text-xs text-muted-foreground">{t('platform.history.lost')}</span>;
    case 'draw':
      return <span className="text-xs text-muted-foreground">{t('platform.history.draw')}</span>;
    case 'result':
      return <span className="font-mono text-xs">{state.text}</span>;
  }
}

export const GameCard = memo(GameCardImpl);
