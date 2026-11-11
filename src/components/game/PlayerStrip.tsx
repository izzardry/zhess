import { useI18n } from '@/lib/i18n';
import type { Color, PieceType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PieceGlyph } from './PieceGlyph';
import { groupCaptured } from './notation';

/** The strip's time slot. The parent formats the text (`formatClock` / `formatElapsed`). */
export interface StripClock {
  /** Formatted reading, e.g. `4:31`, `9.7`, `0.0`. */
  text: string;
  /** This clock is counting down now: drawn on a light chip. */
  running?: boolean;
  /** Below 10 s: bold (the text carries the tenths, DESIGN 11). */
  low?: boolean;
  /** Ran out: `destructive` and bold. */
  flagged?: boolean;
  /** Clock off: the slot shows the time this side used, dimmed (DESIGN 4.2). */
  untimed?: boolean;
  /** Remaining (timed) or used (clock off) ms behind `text`; exposed as `data-ms` for tests. */
  ms?: number;
}

export interface PlayerStripProps {
  /** The player this strip belongs to. */
  color: Color;
  /** Pieces this player has captured (the opponent's color), e.g. `material.captured[color]`. */
  captured: readonly PieceType[];
  /** Material lead in pawns from this player's side; `+N` shows only when positive. */
  advantage: number;
  clock?: StripClock;
  /** The player to move: full opacity; otherwise 50 %. */
  active: boolean;
  /** Face-to-face seating: the far player's strip is drawn upside down (DESIGN 5.2). */
  rotated?: boolean;
  /** False while the UI is hidden: captured pieces and material fade out, the clock stays (DESIGN 4). */
  details?: boolean;
  /** `row` (default): a line along the board edge. `rail`: a compact column for the landscape rail. */
  layout?: 'row' | 'rail';
  className?: string;
}

/**
 * One player's strip at the board edge (DESIGN 4.2): captured pieces (small, grouped by type),
 * the material lead on the side that is ahead, and the clock.
 */
export function PlayerStrip({
  color,
  captured,
  advantage,
  clock,
  active,
  rotated = false,
  details = true,
  layout = 'row',
  className,
}: PlayerStripProps) {
  const { t } = useI18n();
  const side = color === 'w' ? t('white') : t('black');
  const theirs: Color = color === 'w' ? 'b' : 'w';
  const groups = groupCaptured(captured);
  const lead = Math.round(advantage);
  const rail = layout === 'rail';

  const piecesText = groups
    .map((g) => (g.count > 1 ? `${g.count}× ${t(`game.piece.${g.type}`)}` : t(`game.piece.${g.type}`)))
    .join(', ');

  const material = (
    <div
      data-part="material"
      className={cn(
        'flex items-center gap-1.5 min-w-0 transition-opacity duration-chrome ease-out',
        rail && 'flex-wrap justify-center max-w-[5.5rem]',
        details ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden={details ? undefined : true}
    >
      {groups.length > 0 && (
        <span
          role="img"
          aria-label={t('game.capturedBy', { side, pieces: piecesText })}
          className={cn('flex items-center gap-1', rail && 'flex-wrap justify-center')}
        >
          {groups.map((g) => (
            <span key={g.type} data-group={g.type} className="flex items-center">
              {Array.from({ length: g.count }, (_, i) => (
                <PieceGlyph key={i} type={g.type} color={theirs} className={cn('w-4 h-4 text-[15px]', i > 0 && '-ml-2')} />
              ))}
            </span>
          ))}
        </span>
      )}
      {lead > 0 && (
        <span data-part="advantage" className="text-xs text-muted-foreground tabular-nums" aria-label={t('game.materialAhead', { n: lead })}>
          +{lead}
        </span>
      )}
    </div>
  );

  const time = clock && (
    <span
      role="timer"
      aria-label={clock.untimed ? t('game.timeUsed', { side }) : t('game.clock', { side })}
      data-part="clock"
      data-running={clock.running ? 'true' : undefined}
      data-low={clock.low ? 'true' : undefined}
      data-flagged={clock.flagged ? 'true' : undefined}
      data-ms={typeof clock.ms === 'number' ? Math.round(clock.ms) : undefined}
      className={cn(
        'font-mono text-sm tabular-nums tracking-wider px-2 py-0.5 rounded-md shrink-0 transition-colors duration-fast',
        clock.untimed && 'text-muted-foreground',
        clock.running && !clock.untimed && 'bg-foreground/10 text-foreground',
        clock.low && 'font-bold',
        clock.flagged && 'text-destructive font-bold',
      )}
    >
      {clock.text}
    </span>
  );

  return (
    <div
      data-color={color}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'flex items-center select-none transition-opacity duration-chrome ease-out',
        rail ? 'flex-col gap-1.5 text-center' : 'w-full justify-between gap-2 min-h-7',
        active ? 'opacity-100' : 'opacity-50',
        rotated && 'rotate-180',
        className,
      )}
    >
      {rail ? (
        <>
          {time}
          {material}
        </>
      ) : (
        <>
          {material}
          {time}
        </>
      )}
    </div>
  );
}
