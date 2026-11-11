/**
 * Install bottom sheet (Ztyle 10 "Bottom-sheet prompt", 12 "Install"): shown once on the start
 * screen, never in game. Pair with `usePWAInstall().shouldShowPrompt`.
 *
 * Ported from Zudoku `PWAInstallPrompt.tsx` with audit fix #9: pill buttons (ghost / primary).
 */
import { Download, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface PWAInstallPromptProps {
  onInstall: () => void;
  onDismiss: () => void;
}

export function PWAInstallPrompt({ onInstall, onDismiss }: PWAInstallPromptProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
      <div
        role="dialog"
        aria-labelledby="zhess-install-title"
        aria-describedby="zhess-install-body"
        className={cn('pointer-events-auto w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-4 animate-slide-up')}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
            <Download className="w-6 h-6 text-primary" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="zhess-install-title" className="font-mono font-medium tracking-wide text-sm">
              {t('platform.install.title')}
            </h3>
            <p id="zhess-install-body" className="text-xs text-muted-foreground mt-1">
              {t('platform.install.body')}
            </p>
          </div>
          <button type="button" onClick={onDismiss} className="icon-button -mt-1 -mr-1" aria-label={t('dismiss')}>
            <X className="!w-4 !h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onDismiss} className="btn-ghost flex-1">
            {t('platform.install.notNow')}
          </button>
          <button type="button" onClick={onInstall} className="btn-primary flex-1 !px-4 !py-2 !text-xs">
            {t('platform.install.install')}
          </button>
        </div>
      </div>
    </div>
  );
}
