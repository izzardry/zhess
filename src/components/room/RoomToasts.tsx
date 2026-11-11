/**
 * The room's one-line toasts (DESIGN 9.5, 9.7, 9.10, 9.11), through sonner:
 *
 * - Presence transitions: `Opponent joined`, `Opponent connected`, `Opponent disconnected`,
 *   `Reconnected`. They share one id, so a quick flap shows only the latest.
 * - Sync: `Game restored from opponent's copy`, the sync error, a challenge failure, a declined
 *   rejoin, a declined request.
 * - Version mismatch: the reload toast; the service-worker update check runs (`onUpdateCheck`).
 * - The calm failure message, once per cause: ICE failed (`Could not reach your opponent
 *   directly. Try another network.`), broker unreachable, or signalling failing for 10 s; each with
 *   `Connect manually`. It goes away when the room is live.
 *
 * Also renders `RequestToasts` for the requests. Renders nothing itself.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ManualCause } from '@/hooks/useRoom';
import { useI18n } from '@/lib/i18n';
import type { RequestKind, RoomNotice } from '@/lib/types';
import { RequestToasts } from './RequestToasts';
import { manualCauseKey, noticeKey } from './text';

/** Sonner ids used by the room toasts. */
export const ROOM_TOAST_IDS = {
  presence: 'room-presence',
  connect: 'room-connect',
  version: 'room-version',
} as const;

export interface RoomToastsProps {
  /** Subscribes to the room's notices (`RoomHandle.onNotice`). */
  onNotice: (cb: (n: RoomNotice) => void) => () => void;
  /** `RoomSnapshot.requests`. */
  requests?: { readonly incoming?: RequestKind | 'rejoin'; readonly outgoing?: RequestKind } | null;
  /** Answers an incoming request. */
  onReply: (kind: RequestKind | 'rejoin', ok: boolean) => void;
  /** useRoom's `manualCause`: shows the calm failure message. */
  manualCause?: ManualCause | null;
  /** The room is live: the failure message goes away. */
  live?: boolean;
  /** `Connect manually`; without it the failure message has no action. */
  onConnectManually?: () => void;
  /** Triggered on a version mismatch (the service worker update check, DESIGN 9.11). */
  onUpdateCheck?: () => void;
  /** The Reload action of the version toast. Default `location.reload()`. */
  onReload?: () => void;
}

export function RoomToasts({ onNotice, requests, onReply, manualCause, live, onConnectManually, onUpdateCheck, onReload }: RoomToastsProps) {
  const { t } = useI18n();
  const cb = useRef({ t, onConnectManually, onUpdateCheck, onReload });
  cb.current = { t, onConnectManually, onUpdateCheck, onReload };
  /** Failure causes already shown (each once, DESIGN 9.10). */
  const shown = useRef(new Set<string>());

  const showFailure = useRef((cause: ManualCause) => {
    const key = manualCauseKey(cause);
    if (!key || shown.current.has(cause)) return;
    shown.current.add(cause);
    const { t: tr, onConnectManually: connect } = cb.current;
    toast(tr(key), {
      id: ROOM_TOAST_IDS.connect,
      duration: Infinity,
      action: connect
        ? {
            label: tr('room.connectManually'),
            onClick: () => cb.current.onConnectManually?.(),
          }
        : undefined,
    });
  });

  useEffect(
    () =>
      onNotice((n) => {
        const tr = cb.current.t;
        switch (n.kind) {
          case 'opponent-joined':
          case 'opponent-connected':
          case 'opponent-disconnected':
          case 'reconnected':
            toast(tr(noticeKey(n)), { id: ROOM_TOAST_IDS.presence });
            break;
          case 'version-mismatch':
            cb.current.onUpdateCheck?.();
            toast(tr(noticeKey(n)), {
              id: ROOM_TOAST_IDS.version,
              duration: Infinity,
              action: {
                label: tr('room.reload'),
                onClick: () => (cb.current.onReload ?? (() => window.location.reload()))(),
              },
            });
            break;
          case 'ice-failed':
            showFailure.current('ice-failed');
            break;
          default:
            toast(tr(noticeKey(n)));
        }
      }),
    [onNotice],
  );

  useEffect(() => {
    if (manualCause && !live) showFailure.current(manualCause);
  }, [manualCause, live]);

  useEffect(() => {
    if (live) toast.dismiss(ROOM_TOAST_IDS.connect);
  }, [live]);

  return <RequestToasts requests={requests} onReply={onReply} />;
}
