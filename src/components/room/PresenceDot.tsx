/**
 * Presence dot next to the code in the info pill (DESIGN 9.10): solid when the opponent is
 * connected; hollow and pulsing while waiting, connecting or reconnecting. Tapping it opens the
 * invite sheet again.
 */
import { useI18n } from '@/lib/i18n';
import type { Presence } from '@/lib/types';
import { cn } from '@/lib/utils';
import { presenceKey } from './text';

export interface PresenceDotProps {
  presence: Presence;
  /** Opens the invite sheet. Without it the dot is a plain status image. */
  onClick?: () => void;
  className?: string;
}

export function PresenceDot({ presence, onClick, className }: PresenceDotProps) {
  const { t } = useI18n();
  const status = t(presenceKey(presence));
  const connected = presence === 'connected';
  const dot = (
    <span
      aria-hidden="true"
      data-presence={presence}
      className={cn(
        'block w-2 h-2 rounded-full',
        connected ? 'bg-success' : 'border-[1.5px] border-muted-foreground animate-pulse motion-reduce:animate-none',
      )}
    />
  );
  if (!onClick) {
    return (
      <span role="img" aria-label={status} title={status} className={cn('inline-flex items-center justify-center', className)}>
        {dot}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('room.presenceButton', { status })}
      title={status}
      // A 24 px hit area around the 8 px dot, without moving the pill's text.
      className={cn('-m-2 inline-flex items-center justify-center w-6 h-6 rounded-full hover:bg-foreground/5 transition-colors duration-fast', className)}
    >
      {dot}
    </button>
  );
}
