import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Color } from '@/lib/types';

/** How long a resignation can be taken back (DESIGN 8.3, Ztyle 09 undo toasts). */
export const RESIGN_UNDO_MS = 5000;

export interface ResignUndoToastProps {
  /** A resignation just happened and can still be taken back. */
  open: boolean;
  /** Who resigned: `you` against the computer, a color in pass-and-play. */
  who: 'you' | Color;
  /** Undo: take the resignation back (e.g. `zhess.reopen`). */
  onUndo: () => void;
  /** The toast ran out or × was pressed: the resignation is final. Called once per opening. */
  onExpire: () => void;
  durationMs?: number;
}

/**
 * Undo toast for a resignation in solo modes (DESIGN 8.3). Same recipe as Zudoku's
 * DeleteUndoToasts with the audit fix #12: × dismisses (commits) instead of doing nothing.
 * In a room resignation is final, so this toast is not used there.
 */
export function ResignUndoToast({ open, who, onUndo, onExpire, durationMs = RESIGN_UNDO_MS }: ResignUndoToastProps) {
  const { t } = useI18n();
  const cb = useRef({ onUndo, onExpire });
  cb.current = { onUndo, onExpire };
  /** Guards against a double settle (timer and click in the same tick). */
  const settled = useRef(false);

  useEffect(() => {
    if (!open) return;
    settled.current = false;
    const id = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      cb.current.onExpire();
    }, durationMs);
    return () => clearTimeout(id);
  }, [open, durationMs]);

  if (!open) return null;

  const settle = (fn: () => void) => () => {
    if (settled.current) return;
    settled.current = true;
    fn();
  };

  const text =
    who === 'you' ? t('game.youResigned') : who === 'w' ? t('game.reason.whiteResigned') : t('game.reason.blackResigned');

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[60] bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))] w-[min(90vw,360px)]"
    >
      <div className="toast animate-in slide-in-from-bottom-3 fade-in zoom-in-95 duration-[250ms] ease-out">
        <span className="text-sm truncate">{text}</span>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={settle(() => cb.current.onUndo())} className="toast-action">
            {t('undo')}
          </button>
          <button
            type="button"
            onClick={settle(() => cb.current.onExpire())}
            aria-label={t('dismiss')}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
