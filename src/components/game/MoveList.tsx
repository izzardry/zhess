import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import type { Color } from '@/lib/types';
import { cn } from '@/lib/utils';
import { FigurineSan } from './PieceGlyph';
import { movePairs, plyNumber } from './notation';

export interface MoveListProps {
  /** SAN of every recorded ply, including plies after the cursor (review, redo tail). */
  moves: readonly string[];
  /** Plies applied; the ply at `cursor - 1` is marked current. */
  cursor: number;
  /** Number of the first move (1 unless the game started from a position). */
  firstMoveNumber?: number;
  /** Side that made the first ply ('b' when the game started from a position with black to move). */
  firstColor?: Color;
  /**
   * Tap on a move: jump to the position after it. Receives the new cursor (`ply index + 1`; 0 for
   * the start position). Without it the list is read-only.
   */
  onJump?: (cursor: number) => void;
  className?: string;
}

/** All moves, numbered, in figurine notation (DESIGN 4.2, 12.3). Shown in the info pill's popover. */
export function MoveList({ moves, cursor, firstMoveNumber = 1, firstColor = 'w', onJump, className }: MoveListProps) {
  const { t } = useI18n();
  const currentRef = useRef<HTMLElement | null>(null);
  const pairs = movePairs(moves, firstMoveNumber, firstColor);
  const current = Math.min(cursor, moves.length) - 1;

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const cell = (entry: { san: string; ply: number } | undefined, color: Color) => {
    if (!entry) {
      return (
        <span className="px-2 py-1 text-muted-foreground/50" aria-hidden="true">
          {color === 'w' ? '…' : ''}
        </span>
      );
    }
    const isCurrent = entry.ply === current;
    const future = entry.ply >= cursor;
    const { number } = plyNumber(entry.ply, firstMoveNumber, firstColor);
    const cls = cn(
      'px-2 py-1 rounded-md text-left text-sm',
      isCurrent && 'bg-foreground/10 font-semibold',
      future && 'text-foreground/50',
    );
    const content = <FigurineSan san={entry.san} color={color} />;
    if (!onJump) {
      return (
        <span
          ref={isCurrent ? (el) => void (currentRef.current = el) : undefined}
          className={cls}
          aria-current={isCurrent ? 'step' : undefined}
          data-ply={entry.ply}
        >
          {content}
        </span>
      );
    }
    return (
      <button
        type="button"
        ref={isCurrent ? (el) => void (currentRef.current = el) : undefined}
        className={cn(cls, 'hover:bg-foreground/5 transition-colors duration-fast')}
        aria-current={isCurrent ? 'step' : undefined}
        aria-label={t('game.goToMove', { move: `${number}${color === 'w' ? '.' : '…'} ${entry.san}` })}
        data-ply={entry.ply}
        onClick={() => onJump(entry.ply + 1)}
      >
        {content}
      </button>
    );
  };

  return (
    <div className={cn('font-mono', className)}>
      {onJump && (
        <button
          type="button"
          onClick={() => onJump(0)}
          aria-current={current < 0 ? 'step' : undefined}
          className={cn(
            'w-full mb-1 px-2 py-1 rounded-md text-left text-xs uppercase tracking-wider text-muted-foreground hover:bg-foreground/5',
            current < 0 && 'bg-foreground/10 text-foreground',
          )}
        >
          {t('game.startPosition')}
        </button>
      )}
      <ol aria-label={t('game.moves')} className="grid grid-cols-[2.25rem_1fr_1fr] gap-x-1 gap-y-0.5 items-center">
        {pairs.map((pair) => (
          <li key={pair.number} className="contents">
            <span className="text-xs text-muted-foreground text-right pr-1 tabular-nums">{pair.number}.</span>
            {cell(pair.w, 'w')}
            {cell(pair.b, 'b')}
          </li>
        ))}
      </ol>
    </div>
  );
}
