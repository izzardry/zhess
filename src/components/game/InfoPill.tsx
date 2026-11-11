import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/lib/i18n';
import type { Color } from '@/lib/types';
import { cn } from '@/lib/utils';
import { MoveList } from './MoveList';
import { FigurineSan } from './PieceGlyph';
import { formatPoints, stripPair } from './notation';

/** The opponent cell: computer level, pass-and-play, or the room score from this device's view. */
export type InfoOpponent =
  | { readonly kind: 'computer'; readonly level: number }
  | { readonly kind: 'local' }
  /** `score` = [this device's points, opponent's points], in points (halves allowed: 1.5 → `1½`). */
  | { readonly kind: 'room'; readonly score: readonly [number, number] };

export interface InfoPillProps {
  /** The game code. */
  code: string;
  /** Slot next to the code, e.g. the room presence dot. */
  presence?: ReactNode;
  opponent: InfoOpponent;
  /** SAN of every recorded ply (including plies after the cursor in review). */
  moves: readonly string[];
  /** Plies applied. The strip shows the move pair ending at `cursor - 1`. */
  cursor: number;
  firstMoveNumber?: number;
  firstColor?: Color;
  /** Tap on a move in the popover. Receives the new cursor (see `MoveList`). */
  onJump?: (cursor: number) => void;
  /** Chrome shown. */
  visible?: boolean;
  /** Mobile landscape: a vertical card. */
  landscape?: boolean;
  /**
   * `fixed` (default): pinned top-center in portrait, left-center rail in landscape.
   * `inline`: no positioning, for a parent rail that also holds the player strips.
   */
  placement?: 'fixed' | 'inline';
  className?: string;
}

/** Every cell has the same structure and height, so eyebrows and values line up (Ztyle 10). */
const CELL = 'flex flex-col items-center';
const EYEBROW = 'text-[10px] leading-4 uppercase tracking-wider text-muted-foreground';
const VALUE = 'flex h-5 items-center justify-center font-mono text-sm leading-5 tracking-widest whitespace-nowrap';
// Below 360 px (portrait) the pill takes two rows: code and opponent, then the move strip. The
// `max-[359px]:` classes are written out in full so Tailwind's scanner finds them.

/**
 * Info pill (DESIGN 4.2, Ztyle 10 stats pill): game code (+ presence), opponent, move strip.
 * Each cell is eyebrow over value. Tapping the move strip opens the full move list.
 */
export function InfoPill({
  code,
  presence,
  opponent,
  moves,
  cursor,
  firstMoveNumber = 1,
  firstColor = 'w',
  onJump,
  visible = true,
  landscape = false,
  placement = 'fixed',
  className,
}: InfoPillProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const stripId = useId();
  // Hidden chrome must not take focus (`inert` is set on the node; React 18 does not know the attribute).
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wrapRef.current) wrapRef.current.inert = !visible;
    if (!visible) setOpen(false);
  }, [visible]);
  const pair = stripPair(moves, cursor, firstMoveNumber, firstColor);

  const [eyebrow, value] =
    opponent.kind === 'computer'
      ? [t('level'), String(opponent.level)]
      : opponent.kind === 'local'
        ? [t('game.eyebrow.players'), '2']
        : [t('game.eyebrow.score'), `${formatPoints(opponent.score[0])} – ${formatPoints(opponent.score[1])}`];

  const divider = <div aria-hidden="true" className={landscape ? 'w-8 h-px bg-border' : 'h-6 w-px bg-border self-center justify-self-center'} />;
  // The divider before the move strip: in the narrow two-row pill a line across the pill.
  const rowDivider = landscape ? (
    divider
  ) : (
    <div
      aria-hidden="true"
      className="h-6 w-px bg-border max-[359px]:col-span-3 max-[359px]:h-px max-[359px]:w-auto max-[359px]:mx-1"
    />
  );

  const strip = pair ? (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted-foreground">
        {pair.number}
        {pair.w ? '.' : '…'}
      </span>
      {pair.w && <FigurineSan san={pair.w.san} color="w" />}
      {pair.b && <FigurineSan san={pair.b.san} color="b" />}
    </span>
  ) : (
    <span className="text-muted-foreground" aria-hidden="true">
      –
    </span>
  );

  const jump = onJump
    ? (c: number) => {
        setOpen(false);
        onJump(c);
      }
    : undefined;

  const pill = (
    <div
      role="group"
      aria-label={t('game.info')}
      className={cn(
        'pointer-events-auto bg-card/80 backdrop-blur-sm border border-border shadow-lg rounded-2xl text-center',
        // Narrow phones: tighter gaps so the pill fits between Back and Help (Ztyle 05 top row);
        // below 360 px a two-row grid keeps all three cells (DESIGN 4.2).
        landscape
          ? 'inline-flex flex-col items-center gap-3 px-3 py-4'
          : cn(
              'inline-flex items-center gap-2 min-[400px]:gap-3 sm:gap-4 px-2.5 min-[400px]:px-3 sm:px-4 py-2',
              'max-[359px]:inline-grid max-[359px]:grid-cols-[auto_auto_auto] max-[359px]:gap-x-2 max-[359px]:gap-y-0.5 max-[359px]:py-1',
            ),
        placement === 'inline' && className,
      )}
    >
      <div data-cell="code" className={CELL}>
        <div className={EYEBROW}>{t('game.eyebrow.game')}</div>
        <div className={cn(VALUE, 'gap-1.5')}>
          <span>{code}</span>
          {presence}
        </div>
      </div>
      {divider}
      <div data-cell="opponent" className={CELL}>
        <div className={EYEBROW}>{eyebrow}</div>
        <div className={VALUE}>{value}</div>
      </div>
      {rowDivider}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-cell="moves"
            aria-label={t('game.showMoves')}
            aria-describedby={stripId}
            disabled={moves.length === 0}
            className={cn(
              CELL,
              'rounded-lg px-1 -mx-1 hover:bg-foreground/5 active:scale-95 transition-[background-color,transform] duration-fast',
              'disabled:cursor-default disabled:hover:bg-transparent disabled:active:scale-100',
              !landscape && 'max-[359px]:col-span-3 max-[359px]:mx-auto',
            )}
          >
            <div className={EYEBROW}>{t('game.eyebrow.move')}</div>
            <div id={stripId} className={cn(VALUE, 'tracking-wide')}>
              {strip}
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={landscape ? 'right' : 'bottom'}
          sideOffset={8}
          className="w-64 max-w-[calc(100vw-2rem)] max-h-[min(60vh,420px)] overflow-y-auto p-2 rounded-xl"
        >
          <MoveList
            moves={moves}
            cursor={cursor}
            firstMoveNumber={firstMoveNumber}
            firstColor={firstColor}
            onJump={jump}
          />
        </PopoverContent>
      </Popover>
    </div>
  );

  if (placement === 'inline') return pill;

  return (
    <div
      ref={wrapRef}
      data-visible={visible ? 'true' : 'false'}
      aria-hidden={visible ? undefined : true}
      className={cn(
        'fixed z-chrome transition-all duration-chrome ease-out',
        landscape
          ? 'top-1/2 -translate-y-1/2 left-[max(1rem,env(safe-area-inset-left))]'
          : 'top-[max(1rem,env(safe-area-inset-top))] inset-x-0 text-center pointer-events-none',
        visible
          ? 'opacity-100'
          : cn('opacity-0 pointer-events-none', landscape ? '-translate-x-8' : '-translate-y-8'),
        className,
      )}
    >
      {pill}
    </div>
  );
}
