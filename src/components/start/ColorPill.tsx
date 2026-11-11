/**
 * Color pill (DESIGN 4.1): cycles random → white → black. Default random, remembered by the
 * caller. In a room a joiner sees it dimmed and disabled, because the creator's choice applies.
 *
 * The glyph is monochrome: half-filled disc = random, outlined disc = white, solid disc = black
 * (the piece set's own convention: white outlined, black solid).
 */
import { useI18n } from '@/lib/i18n';
import type { ColorChoice } from '@/lib/types';
import { cn } from '@/lib/utils';
import { nextColor } from './options';
import { useColorName } from './text';

export interface ColorPillProps {
  value: ColorChoice;
  onChange: (value: ColorChoice) => void;
  /** Dimmed and not changeable (room joiner, or RESUME / REVIEW). */
  disabled?: boolean;
  className?: string;
}

/** The pill's 12 px disc glyph. */
export function ColorGlyph({ value, className }: { value: ColorChoice; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn('h-3 w-3 shrink-0', className)} data-glyph={value}>
      <circle cx="6" cy="6" r="5" fill={value === 'b' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.25" />
      {value === 'random' && <path d="M6 1 A5 5 0 0 1 6 11 Z" fill="currentColor" />}
    </svg>
  );
}

export function ColorPill({ value, onChange, disabled = false, className }: ColorPillProps) {
  const { t } = useI18n();
  const name = useColorName(value);
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(nextColor(value))}
      disabled={disabled}
      aria-label={disabled ? t('start.colorLockedAria', { value: name }) : t('start.colorAria', { value: name })}
      data-testid="color-pill"
      data-value={value}
      className={cn(
        'pill-sm min-h-9 px-4 font-mono lowercase text-foreground/80',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-card/80 hover:text-foreground/80',
        className,
      )}
    >
      <ColorGlyph value={value} />
      <span>{name}</span>
    </button>
  );
}
