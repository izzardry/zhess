/**
 * Request toasts (DESIGN 9.5, 9.7, 8.3): the quiet pattern of all room requests.
 *
 * - Incoming takeback, draw, rematch: an undo-style toast with Decline and Accept. Rejoin from a
 *   new device: Decline and Allow. It stays until answered and disappears by itself when the
 *   request lapses (the requester moved, the opponent moved, the game changed, the peer left).
 * - Outgoing: a pending toast (`Draw offered`, waiting for the opponent) while the request is
 *   open. The toolbar shows the same pending state on its button.
 *
 * Toasts go through sonner (`toast.custom`, Ztyle toast markup) with fixed ids, so a request is
 * shown once however often the component renders. Renders nothing itself.
 */
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';
import type { RequestKind } from '@/lib/types';
import { pendingKey, requestKey } from './text';

/** Sonner ids of the two request toasts. */
export const INCOMING_TOAST_ID = 'room-request-in';
export const OUTGOING_TOAST_ID = 'room-request-out';

export interface RequestToastsProps {
  /** `RoomSnapshot.requests`. */
  requests: { readonly incoming?: RequestKind | 'rejoin'; readonly outgoing?: RequestKind } | null | undefined;
  /** Answers the incoming request (`RoomController.reply`). */
  onReply: (kind: RequestKind | 'rejoin', ok: boolean) => void;
}

export function RequestToasts({ requests, onReply }: RequestToastsProps) {
  const { t } = useI18n();
  const replyRef = useRef(onReply);
  replyRef.current = onReply;
  const incoming = requests?.incoming;
  const outgoing = requests?.outgoing;

  useEffect(() => {
    if (!incoming) return;
    const kind = incoming;
    const answer = (ok: boolean) => {
      toast.dismiss(INCOMING_TOAST_ID);
      replyRef.current(kind, ok);
    };
    toast.custom(
      () => (
        <div role="alertdialog" aria-label={t(requestKey(kind))} data-request={kind} className="toast w-[min(90vw,360px)] font-mono">
          <span className="text-sm min-w-0">{t(requestKey(kind))}</span>
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

  useEffect(() => {
    if (!outgoing) return;
    const kind = outgoing;
    toast.custom(
      () => (
        <div role="status" data-pending={kind} className="toast w-[min(90vw,360px)] font-mono">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">{t(pendingKey(kind))}</span>
            <span className="text-xs text-muted-foreground">{t('room.pending.waiting')}</span>
          </span>
          <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />
        </div>
      ),
      { id: OUTGOING_TOAST_ID, duration: Infinity },
    );
    return () => {
      toast.dismiss(OUTGOING_TOAST_ID);
    };
  }, [outgoing, t]);

  return null;
}
