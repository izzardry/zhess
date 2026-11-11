/**
 * Back-to-top FAB (Ztyle 10 `.fab--lg`): bottom right, appears once the start screen is
 * scrolled past 50 px and slides away otherwise.
 */
import { ChevronUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { scrollToTop } from './useScrolled';

export interface BackToTopProps {
  visible: boolean;
  /** Override the scroll (tests). */
  onClick?: () => void;
  className?: string;
}

export function BackToTop({ visible, onClick = scrollToTop, className }: BackToTopProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('start.backToTopAria')}
      aria-hidden={!visible || undefined}
      tabIndex={visible ? undefined : -1}
      data-testid="back-to-top"
      data-visible={visible}
      className={cn(
        'fab fab--lg fixed z-30',
        'bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))] right-[max(1rem,env(safe-area-inset-right))]',
        'transition-all duration-300 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-8 opacity-0',
        className,
      )}
    >
      <ChevronUp aria-hidden="true" />
    </button>
  );
}
