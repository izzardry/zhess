import { useEffect, useRef, useState } from 'react';
import { Loader2, Share2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { formatElapsed } from '@/lib/timeUtils';
import type { Color, GameEnd, Mode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ShareMenu } from './ShareMenu';
import { endTexts, tintClass, type Tint } from './outcome';
import { fullMoves } from './notation';

/** Delay between the page tint starting and the overlay appearing (DESIGN 8.4, Ztyle 09). */
export const TINT_MS = 1000;

export interface PageTintProps {
  /** `success` for a win, `destructive` for a loss, null for none (see `tintFor`). */
  tint: Tint;
  className?: string;
}

/**
 * The page-wide end-of-game tint (Ztyle `page-tint`): `success/12` or `destructive/12`, fading in
 * over 1000 ms. A `fixed inset-0 -z-10 pointer-events-none` layer, so it sits under the stage's
 * content; keep it mounted (tint null) so it can fade. It stays after the overlay is dismissed.
 *
 * Its parent must form a stacking context (`isolate`, as the stage root does). Without one the
 * negative layer joins the root stacking context and paints before the opaque html / body
 * backgrounds, which hide it completely.
 */
export function PageTint({ tint, className }: PageTintProps) {
  return (
    <div
      aria-hidden="true"
      data-tint={tint ?? 'none'}
      className={cn(
        tintClass(tint),
        'fixed inset-0 -z-10 pointer-events-none',
        className,
      )}
    />
  );
}

export interface GameOverOverlayProps {
  /** The game has ended and the overlay should show (after `delayMs`). */
  open: boolean;
  end: GameEnd;
  mode: Mode;
  /** This device's side (ignored in pass-and-play). */
  myColor: Color;
  code: string;
  /** Computer level, for the summary line. */
  level?: number;
  /** Plies played; the summary shows full moves. */
  plies: number;
  /** Time used by both sides together. */
  durationMs: number;
  /** Ghost Share: the game link. */
  onShare: () => void;
  /** With this set, Share opens a menu with the link and `Copy PGN` (DESIGN 13.2 finished game). */
  onCopyPgn?: () => void;
  /** Primary action: New game (computer, pass-and-play) or Rematch (room). */
  onPrimary: () => void;
  /** Rematch asked and waiting for the opponent: the primary button spins and is disabled. */
  primaryBusy?: boolean;
  /** Scrim tap or Escape: hide the overlay to look at the board. */
  onDismiss: () => void;
  /** Wait for the page tint before appearing; default 1000 ms. */
  delayMs?: number;
}

/**
 * Game-over overlay (DESIGN 8.4, Ztyle 09 "End of game"): blurred scrim, glyph, title, reason,
 * summary `K7QW2M • Level 5 • 34 moves • 12:08`, ghost Share and primary New game / Rematch.
 */
export function GameOverOverlay({
  open,
  end,
  mode,
  myColor,
  code,
  level,
  plies,
  durationMs,
  onShare,
  onCopyPgn,
  onPrimary,
  primaryBusy = false,
  onDismiss,
  delayMs = TINT_MS,
}: GameOverOverlayProps) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    if (delayMs <= 0) {
      setShown(true);
      return;
    }
    const id = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(id);
  }, [open, delayMs]);

  // Focus the primary action when the overlay appears; give focus back when it goes.
  useEffect(() => {
    if (!shown) return;
    returnFocus.current = typeof document !== 'undefined' ? document.activeElement : null;
    primaryRef.current?.focus();
    return () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, [shown]);

  if (!open || !shown) return null;

  const texts = endTexts(end, mode, myColor);
  const n = fullMoves(plies);
  const opponent = mode === 'computer' ? `${t('level')} ${level ?? ''}`.trim() : mode === 'local' ? t('twoPlayers') : t('room');
  const summary = [code, opponent, n === 1 ? t('game.summary.move') : t('game.summary.moves', { n }), formatElapsed(durationMs)].join(' • ');

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Keys from the share menu (portaled, but bubbling through the React tree) belong to the menu.
    if (!e.currentTarget.contains(e.target as Node)) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDismiss();
      return;
    }
    if (e.key !== 'Tab') return;
    // Trap focus inside the overlay (Ztyle 16).
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const shareButton = (
    <button type="button" onClick={onCopyPgn ? undefined : onShare} className="btn-ghost" data-action="share">
      <Share2 className="w-4 h-4" aria-hidden="true" />
      {t('share')}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-over-title"
      aria-describedby="game-over-summary"
      data-testid="game-over"
      className="fixed inset-0 z-overlay scrim flex items-center justify-center animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="text-center p-8 animate-scale-in max-w-md">
        {texts.glyph && (
          <div className="text-6xl mb-6" aria-hidden="true">
            🎉
          </div>
        )}
        <h2 id="game-over-title" className="text-2xl font-mono font-bold mb-2">
          {t(texts.title)}
        </h2>
        {texts.reason && <p className="text-sm mb-2">{t(texts.reason)}</p>}
        <p id="game-over-summary" className="text-muted-foreground mb-8">
          {summary}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          {onCopyPgn ? <ShareMenu trigger={shareButton} onShareLink={onShare} onCopyPgn={onCopyPgn} side="top" /> : shareButton}
          <button
            ref={primaryRef}
            type="button"
            onClick={onPrimary}
            disabled={primaryBusy}
            aria-busy={primaryBusy || undefined}
            className={cn('btn-primary', primaryBusy && 'opacity-60 cursor-wait')}
            data-action="primary"
          >
            {primaryBusy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {mode === 'room' ? t('rematch') : t('newGame')}
          </button>
        </div>
      </div>
    </div>
  );
}
