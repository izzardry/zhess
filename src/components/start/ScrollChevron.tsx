/**
 * Bounce chevron under the start footer (Ztyle 08 "Scrolling"): hints that history waits below
 * the fold; a click smooth-scrolls one viewport down.
 */
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { scrollOneViewport } from './useScrolled';

export interface ScrollChevronProps {
  /** Fades out (e.g. once scrolled). */
  hidden?: boolean;
  /** Override the scroll (tests, or a custom scroll container). */
  onClick?: () => void;
  className?: string;
}

export function ScrollChevron({ hidden = false, onClick = scrollOneViewport, className }: ScrollChevronProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('start.scrollDownAria')}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      data-testid="scroll-chevron"
      className={cn(
        'animate-bounce rounded-full p-1 text-muted-foreground/50 transition-opacity duration-300 hover:text-muted-foreground',
        hidden ? 'pointer-events-none opacity-0' : 'opacity-100',
        className,
      )}
    >
      <ChevronDown aria-hidden="true" className="h-6 w-6" />
    </button>
  );
}
