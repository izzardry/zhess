/**
 * The one primary action of the start screen (DESIGN 4.1, Ztyle 10 `.btn-primary`), centered on
 * the blurred board. Its label follows the context: START, RESUME or REVIEW (see `startLabel`).
 *
 * `loading` + `progress` show the engine download of milestone 2: a spinner and the percentage
 * inside the pill, with a tooltip of the progress. A tap while loading cancels the pending start
 * and restores the idle pill (Ztyle 09 "Loading & long work"); the download goes on in the
 * background, so a later Start picks it up.
 */
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { StartLabel } from './options';

export interface StartPillProps {
  label: StartLabel;
  onClick: () => void;
  /** Shows a spinner; a press calls `onCancel` instead of `onClick` (engine loading). */
  loading?: boolean;
  /** A press while loading: stop waiting and restore the idle pill. */
  onCancel?: () => void;
  /** 0..1 while loading; shown as a percentage when given. */
  progress?: number;
  /** Blocks presses without a spinner (e.g. during the start transition). */
  disabled?: boolean;
  className?: string;
}

export function StartPill({ label, onClick, loading = false, onCancel, progress, disabled = false, className }: StartPillProps) {
  const { t } = useI18n();
  const text = t(label);
  const percent =
    loading && typeof progress === 'number' && Number.isFinite(progress)
      ? Math.round(Math.min(1, Math.max(0, progress)) * 100)
      : null;

  const tip = loading ? t('start.loadingTip', { percent: percent ?? 0 }) : undefined;

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (loading) onCancel?.();
        else onClick();
      }}
      disabled={disabled}
      aria-busy={loading || undefined}
      title={tip}
      data-testid="start-pill"
      data-label={label}
      className={cn('btn-primary font-mono', loading && 'cursor-wait', className)}
    >
      {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
      <span>{text}</span>
      {loading && (
        <span
          role="progressbar"
          aria-label={t('start.loadingAria', { percent: percent ?? 0 })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          className="min-w-[3ch] text-xs tabular-nums opacity-70"
        >
          {percent !== null ? `${percent}%` : null}
        </span>
      )}
    </button>
  );
}
