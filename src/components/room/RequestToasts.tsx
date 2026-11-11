/**
 * Request toasts (DESIGN 9.5, 9.7, 8.3): the quiet pattern of all room requests.
 *
 * - Incoming takeback, draw, rematch: an undo-style toast with Decline and Accept. Rejoin from a
 *   new device: Decline and Allow. It stays until answered and disappears by itself when the
 *   request lapses (the requester moved, the opponent moved, the game changed, the peer left).
 * - Outgoing: no toast. The requester sees the pending state on the button that asked (DESIGN
 *   9.7): the undo button (takeback), the flag (draw) and the overlay's Rematch. A toast here
 *   would sit on the toolbar at phone width for as long as the request is open.
 *
 * Toasts go through sonner (`toast.custom`) with a fixed id, so a request is shown once however
 * often the component renders. The Toaster frames every toast (Ztyle `.toast`, see
 * `components/ui/sonner.tsx`), so the custom content only lays out the text and the buttons.
 * Renders nothing itself.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';
import type { RequestKind } from '@/lib/types';
import { requestKey } from './text';

/** Sonner id of the incoming request toast. */
export const INCOMING_TOAST_ID = 'room-request-in';

export interface RequestToastsProps {
  /** `RoomSnapshot.requests`; only `incoming` shows a toast. */
  requests: { readonly incoming?: RequestKind | 'rejoin'; readonly outgoing?: RequestKind } | null | undefined;
  /** Answers the incoming request (`RoomController.reply`). */
  onReply: (kind: RequestKind | 'rejoin', ok: boolean) => void;
}

export function RequestToasts({ requests, onReply }: RequestToastsProps) {
  const { t } = useI18n();
  const replyRef = useRef(onReply);
  replyRef.current = onReply;
  const incoming = requests?.incoming;

  useEffect(() => {
    if (!incoming) return;
    const kind = incoming;
    const answer = (ok: boolean) => {
      toast.dismiss(INCOMING_TOAST_ID);
      replyRef.current(kind, ok);
    };
    toast.custom(
      () => (
        <div
          role="alertdialog"
          aria-label={t(requestKey(kind))}
          data-request={kind}
          className="flex w-full min-w-0 items-center justify-between gap-3 font-mono text-sm"
        >
          <span className="min-w-0">{t(requestKey(kind))}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => answer(false)}
              className="px-2 py-1 rounded-md text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors duration-fast"
            >
              {t('decline')}
            </button>
            <button type="button" onClick={() => answer(true)} className="toast-action">
              {t(kind === 'rejoin' ? 'allow' : 'accept')}
            </button>
          </div>
        </div>
      ),
      { id: INCOMING_TOAST_ID, duration: Infinity, dismissible: false },
    );
    return () => {
      toast.dismiss(INCOMING_TOAST_ID);
    };
  }, [incoming, t]);

  return null;
}
