/**
 * Offline state of the computer on the start screen (DESIGN 4.1, 14): download progress on the
 * first launch, then "ready offline". When the copy is missing it says why, and a tap retries.
 * Nothing is shown while checking or where offline caching is unsupported.
 */
import { Check, Download, RotateCw, WifiOff } from 'lucide-react';
import type { EngineOfflineStatus } from '@/lib/engine/offline';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface EngineStatusProps {
  state: EngineOfflineStatus;
  /** Starts (or retries) the download. */
  onDownload: () => void;
  className?: string;
}

const LINE = 'flex h-6 items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground';

export function EngineStatus({ state, onDownload, className }: EngineStatusProps) {
  const { t } = useI18n();
  if (state.status === 'unsupported' || state.status === 'checking') return null;

  if (state.status === 'downloading') {
    return (
      <div className={cn(LINE, className)} data-testid="engine-status" data-status="downloading">
        <span>{t('start.engine.downloading', { percent: state.percent })}</span>
        <span
          role="progressbar"
          aria-label={t('start.engine.downloadingAria')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.percent}
          className="relative h-0.5 w-12 overflow-hidden rounded-full bg-foreground/15"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-foreground/60 transition-[width] duration-200 ease-out"
            style={{ width: `${state.percent}%` }}
          />
        </span>
      </div>
    );
  }

  if (state.status === 'ready') {
    return (
      <div role="status" className={cn(LINE, 'text-muted-foreground/60', className)} data-testid="engine-status" data-status="ready">
        <Check aria-hidden className="h-3 w-3" />
        <span>{t('start.engine.ready')}</span>
      </div>
    );
  }

  if (state.reason === 'offline') {
    return (
      <div role="status" className={cn(LINE, className)} data-testid="engine-status" data-status="offline">
        <WifiOff aria-hidden className="h-3 w-3" />
        <span>{t('start.engine.offline')}</span>
      </div>
    );
  }

  const Icon = state.reason === 'failed' ? RotateCw : Download;
  return (
    <button
      type="button"
      onClick={onDownload}
      className={cn(LINE, 'rounded-full px-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60', className)}
      data-testid="engine-status"
      data-status={state.reason}
    >
      <Icon aria-hidden className="h-3 w-3" />
      <span>{t(state.reason === 'failed' ? 'start.engine.failed' : 'start.engine.saveData')}</span>
    </button>
  );
}
