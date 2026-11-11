/**
 * Opponent stepper (DESIGN 4.1), Zudoku's level stepper extended to
 * ROOM · TWO PLAYERS · COMPUTER 1 BEGINNER … COMPUTER 12 INSANE:
 *
 *   ‹   COMPUTER · LEVEL 5   ›
 *            Medium
 *
 * Ends do not wrap and their chevron fades to 30 % (Ztyle stepper). ArrowLeft / ArrowRight step
 * while focus is inside the selector. `disabled` shows a resumed game's opponent, dimmed.
 */
import { type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Opponent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { canStepOpponent, stepOpponent } from './options';
import { useOpponentText } from './text';

export interface OpponentSelectorProps {
  value: Opponent;
  onChange: (value: Opponent) => void;
  /** Dimmed and not changeable: RESUME / REVIEW show the saved game's opponent. */
  disabled?: boolean;
  /** Tighter spacing for mobile landscape. */
  landscape?: boolean;
  className?: string;
}

export function OpponentSelector({ value, onChange, disabled = false, landscape = false, className }: OpponentSelectorProps) {
  const { t } = useI18n();
  const { kind, name } = useOpponentText(value);
  const canPrev = !disabled && canStepOpponent(value, -1);
  const canNext = !disabled && canStepOpponent(value, 1);

  const step = (delta: number) => {
    if (disabled || !canStepOpponent(value, delta)) return;
    onChange(stepOpponent(value, delta));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    }
  };

  return (
    <div
      role="group"
      aria-label={disabled ? t('start.opponentLockedAria', { value: `${kind}, ${name}` }) : t('start.opponentAria')}
      onKeyDown={onKeyDown}
      data-testid="opponent-selector"
      className={cn('flex items-center justify-center', landscape ? 'gap-2' : 'gap-4', className)}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={!canPrev}
        aria-label={t('start.opponentPrevAria')}
        className="icon-button [&_svg]:h-6 [&_svg]:w-6"
      >
        <ChevronLeft />
      </button>

      <div
        className={cn('min-w-[180px] text-center transition-opacity duration-200', disabled && 'opacity-50')}
        aria-live="polite"
        aria-atomic="true"
      >
        <div className={cn('overline', landscape ? 'text-xs' : 'mb-1')} data-testid="opponent-kind">
          {kind}
        </div>
        <div className={cn('font-mono font-medium', landscape ? 'text-base' : 'text-lg')} data-testid="opponent-name">
          {name}
        </div>
      </div>

      <button
        type="button"
        onClick={() => step(1)}
        disabled={!canNext}
        aria-label={t('start.opponentNextAria')}
        className="icon-button [&_svg]:h-6 [&_svg]:w-6"
      >
        <ChevronRight />
      </button>
    </div>
  );
}
