/**
 * Stacked undo toasts for deletions (Ztyle 09 "Undo toasts").
 *
 *   ┌──────────────────────────────────────┐
 *   │ K7QW2M removed           [UNDO]  ×   │
 *   └──────────────────────────────────────┘
 *             [ UNDO ALL ]                     when ≥ 2 are stacked
 *
 * The deletion has already happened; Undo restores. 5 s lifetime, and every new deletion
 * restarts the timer for the whole stack. × dismisses that one toast, which makes its deletion
 * final (Ztyle audit #12: Zudoku's × did nothing).
 *
 * Ported from Zudoku `DeleteUndoToasts.tsx`, made generic over the deleted item.
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const UNDO_TOAST_MS = 5000;

export interface PendingDeletion<T = unknown> {
  /** Unique per deletion. */
  id: string;
  /** What the toast names, e.g. the game code `K7QW2M`. Shown in mono with tracking. */
  subject: string;
  /** The deleted thing, handed back on undo. */
  item: T;
}

export interface DeleteUndoToastsProps<T = unknown> {
  deletions: readonly PendingDeletion<T>[];
  onUndo: (id: string) => void;
  onUndoAll: () => void;
  /** × on one toast: drop it from the stack (its deletion stays). */
  onDismiss: (id: string) => void;
  /** The stack timed out: all deletions are final. */
  onExpire: () => void;
  /** Lifetime; default 5 s. */
  durationMs?: number;
  className?: string;
}

export function DeleteUndoToasts<T>({
  deletions,
  onUndo,
  onUndoAll,
  onDismiss,
  onExpire,
  durationMs = UNDO_TOAST_MS,
  className,
}: DeleteUndoToastsProps<T>) {
  const { t } = useI18n();
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Restart the timer whenever a new deletion lands on the stack (the newest id changes).
  const newest = deletions.length > 0 ? deletions[deletions.length - 1].id : null;
  useEffect(() => {
    if (newest === null) return;
    const timer = setTimeout(() => onExpireRef.current(), durationMs);
    return () => clearTimeout(timer);
  }, [newest, durationMs]);

  // "{subject} removed": render the subject in mono and the rest muted, in any word order.
  const [before, after] = splitTemplate(t('removed'), '{subject}');

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))] left-1/2 -translate-x-1/2 z-50',
        'flex flex-col items-center gap-2 w-[min(90vw,360px)]',
        deletions.length === 0 && 'pointer-events-none',
        className,
      )}
    >
      {deletions.length > 1 && (
        <button
          type="button"
          onClick={onUndoAll}
          className="px-4 py-1.5 rounded-full bg-foreground text-background font-mono text-xs uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all shadow-lg"
        >
          {t('undoAll')}
        </button>
      )}
      {deletions.map((d) => (
        <div
          key={d.id}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-card border border-border shadow-lg animate-in slide-in-from-bottom-3 fade-in zoom-in-95 duration-200 ease-out"
        >
          <span className="text-sm truncate">
            {before && <span className="text-muted-foreground">{before}</span>}
            <span className="font-mono tracking-wider">{d.subject}</span>
            {after && <span className="text-muted-foreground">{after}</span>}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onUndo(d.id)}
              className="px-3 py-1 rounded-md bg-foreground text-background font-mono text-xs uppercase tracking-wider hover:opacity-90 active:scale-95 transition-all"
            >
              {t('undo')}
            </button>
            <button
              type="button"
              onClick={() => onDismiss(d.id)}
              aria-label={t('dismiss')}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Splits a translated template around a placeholder: `"{subject} removed"` → `["", " removed"]`. */
function splitTemplate(text: string, placeholder: string): [string, string] {
  const i = text.indexOf(placeholder);
  if (i < 0) return ['', ` ${text}`];
  return [text.slice(0, i), text.slice(i + placeholder.length)];
}
