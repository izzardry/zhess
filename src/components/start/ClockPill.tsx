/**
 * Clock pill (DESIGN 4.1, 11): tap cycles off · 1+0 · 3+2 · 5+0 · 10+0 · 15+10 · 30+0.
 *
 * A 500 ms hold calls `onLongPress` (milestone 2 opens its custom dial there; this package does
 * not implement the dial). The hold suppresses the click that follows release (Ztyle 08 ladder).
 * Keyboard path for the hold: Shift+Enter, Shift+F10 or the ContextMenu key.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { Timer } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { TimeControl } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatTc } from '@/lib/zhess';
import { nextClock } from './options';
import { useClockText } from './text';

/** Hold time that opens the custom dial (Ztyle long-press ladder, 500 ms tier). */
export const CLOCK_HOLD_MS = 500;

/** Where the hold happened, so the dial can open at the finger. */
export interface ClockPillAnchor {
  /** Viewport coordinates of the pointer (or of the pill's center for the keyboard path). */
  x: number;
  y: number;
  /** The pill's bounding rectangle. */
  rect: DOMRect;
}

export interface ClockPillProps {
  value: TimeControl;
  onChange: (value: TimeControl) => void;
  /** Called after a 500 ms hold. When omitted, the pill has no hold behavior. */
  onLongPress?: (anchor: ClockPillAnchor) => void;
  /** Dimmed and not changeable (RESUME / REVIEW). */
  disabled?: boolean;
  className?: string;
}

export function ClockPill({ value, onChange, onLongPress, disabled = false, className }: ClockPillProps) {
  const { t } = useI18n();
  const text = useClockText(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const anchorAt = (x?: number, y?: number): ClockPillAnchor => {
    const rect = button.current?.getBoundingClientRect() ?? new DOMRect();
    return { x: x ?? rect.left + rect.width / 2, y: y ?? rect.top + rect.height / 2, rect };
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    held.current = false;
    if (!onLongPress || disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    clear();
    const { clientX, clientY } = e;
    timer.current = setTimeout(() => {
      timer.current = null;
      held.current = true;
      onLongPress(anchorAt(clientX, clientY));
    }, CLOCK_HOLD_MS);
  };

  const onClick = () => {
    if (held.current) {
      // The click that ends a hold is not a tap.
      held.current = false;
      return;
    }
    if (!disabled) onChange(nextClock(value));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!onLongPress || disabled) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && (e.key === 'Enter' || e.key === 'F10'))) {
      e.preventDefault();
      onLongPress(anchorAt());
    }
  };

  const label = disabled
    ? t('start.clockLockedAria', { value: text })
    : onLongPress
      ? t('start.clockHoldAria', { value: text })
      : t('start.clockAria', { value: text });

  return (
    <button
      ref={button}
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => onLongPress && e.preventDefault()}
      onClick={onClick}
      onKeyDown={onKeyDown}
      disabled={disabled}
      aria-label={label}
      data-testid="clock-pill"
      data-value={formatTc(value) ?? 'off'}
      className={cn(
        'pill-sm min-h-9 touch-manipulation px-4 font-mono lowercase text-foreground/80 [-webkit-touch-callout:none]',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-card/80 hover:text-foreground/80',
        className,
      )}
    >
      <Timer aria-hidden="true" />
      <span className="tabular-nums">{text}</span>
    </button>
  );
}
