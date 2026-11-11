/**
 * The room's one-line toasts (DESIGN 9.5, 9.7, 9.10, 9.11), through sonner:
 *
 * - Presence transitions: `Opponent joined`, `Opponent connected`, `Opponent disconnected`,
 *   `Reconnected`. They share one slot (`toastSlot.ts`), so a quick flap shows only the latest.
 * - Sync: `Game restored from opponent's copy`, the sync error, a challenge failure, a declined
 *   rejoin, a declined request.
 * - Version mismatch: the reload toast; the service-worker update check runs (`onUpdateCheck`).
 * - The calm failure message, once per cause: ICE failed (`Could not reach your opponent
 *   directly. Try another network.`), broker unreachable, or signalling failing for 10 s; each with
 *   `Connect manually`. It goes away when the room is live. While `quiet` (the invite sheet or the
 *   manual sheet is open, both of which carry the cause or the step themselves, or this device is
 *   the guest of a manual exchange) it is held back, and it comes back when `quiet` ends if the
 *   room is still not live and the message was not answered (its button) or swiped away. The
 *   once-per-cause memory belongs to one room: another room (`room`) starts afresh.
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
import { createToastSlot } from './toastSlot';

/** Sonner ids used by the room toasts (presence and connect are prefixes: one id per showing). */
export const ROOM_TOAST_IDS = {
  presence: 'room-presence',
  connect: 'room-connect',
  version: 'room-version',
} as const;

export interface RoomToastsProps {
  /** The room's code: the failure causes already announced are remembered per room. */
  room?: string;
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
  /**
   * Holds the failure message back: a sheet that shows the cause or the manual step is open, or
   * this device is the guest of a manual exchange (an `x` link), where `Connect manually` makes no
   * sense. A message held back shows when `quiet` ends and the room is still not live.
   */
  quiet?: boolean;
  /** `Connect manually`; without it the failure message has no action. */
  onConnectManually?: () => void;
  /** Triggered on a version mismatch (the service worker update check, DESIGN 9.11). */
  onUpdateCheck?: () => void;
  /** The Reload action of the version toast. Default `location.reload()`. */
  onReload?: () => void;
}

export function RoomToasts({ room, onNotice, requests, onReply, manualCause, live, quiet = false, onConnectManually, onUpdateCheck, onReload }: RoomToastsProps) {
  const { t } = useI18n();
  const cb = useRef({ t, onConnectManually, onUpdateCheck, onReload });
  cb.current = { t, onConnectManually, onUpdateCheck, onReload };
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  /** Failure causes already announced (each once, DESIGN 9.10). */
  const shown = useRef(new Set<string>());
  /** The announced cause whose message is still owed: not answered, not swiped away, not live. */
  const outstanding = useRef<ManualCause | null>(null);
  /** The failure message: a fresh sonner id per showing, updated in place while on screen. */
  const connectSlot = useRef(createToastSlot(ROOM_TOAST_IDS.connect)).current;
  /** The presence toast: one at a time, the latest transition replaces the one on screen. */
  const presenceSlot = useRef(createToastSlot(ROOM_TOAST_IDS.presence)).current;

  /** Puts the failure message on screen, replacing an earlier showing. */
  const present = useRef((cause: ManualCause) => {
    const key = manualCauseKey(cause);
    if (!key) return;
    const { t: tr, onConnectManually: connect } = cb.current;
    const id = connectSlot.show();
    const gone = () => connectSlot.gone(id);
    toast(tr(key), {
      id,
      duration: Infinity,
      // Only a user's swipe calls this (sonner): the message is answered.
      onDismiss: () => {
        gone();
        if (outstanding.current === cause) outstanding.current = null;
      },
      action: connect
        ? {
            label: tr('room.connectManually'),
            onClick: () => {
              // sonner closes the toast after its action.
              gone();
              outstanding.current = null;
              cb.current.onConnectManually?.();
            },
          }
        : undefined,
    });
  });

  const showFailure = useRef((cause: ManualCause) => {
    if (!manualCauseKey(cause) || shown.current.has(cause)) return;
    shown.current.add(cause);
    outstanding.current = cause;
    if (!quietRef.current) present.current(cause);
  });

  useEffect(
    () =>
      onNotice((n) => {
        const tr = cb.current.t;
        switch (n.kind) {
          case 'opponent-joined':
          case 'opponent-connected':
          case 'opponent-disconnected':
          case 'reconnected': {
            const id = presenceSlot.show();
            const gone = () => presenceSlot.gone(id);
            toast(tr(noticeKey(n)), { id, onDismiss: gone, onAutoClose: gone });
            break;
          }
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
    [onNotice, presenceSlot],
  );

  // Another room: its failures are announced afresh; what the previous room still owed is dropped.
  const roomSeen = useRef(room);
  useEffect(() => {
    if (roomSeen.current === room) return;
    roomSeen.current = room;
    shown.current.clear();
    outstanding.current = null;
    connectSlot.dismiss();
  }, [room, connectSlot]);

  useEffect(() => {
    if (manualCause && !live) showFailure.current(manualCause);
  }, [manualCause, live, room]);

  // Live: the message has done its job. Quiet: it steps aside for the sheet (or the manual guest)
  // and comes back afterwards if it is still owed.
  useEffect(() => {
    if (live) outstanding.current = null;
    if (live || quiet) {
      connectSlot.dismiss();
      return;
    }
    if (outstanding.current && !connectSlot.onScreen) present.current(outstanding.current);
  }, [live, quiet, connectSlot]);

  return <RequestToasts requests={requests} onReply={onReply} />;
}
