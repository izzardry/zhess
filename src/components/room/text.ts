/**
 * Pure helpers of the room UI: which string a presence, notice, request or manual problem shows,
 * when the invite sheet should open by itself, and the transient `x` / `y` URL parameters.
 */
import type { ManualCause, ManualIssue } from '@/hooks/useRoom';
import type { TranslationKey } from '@/lib/i18n';
import type { RoomState } from '@/lib/room';
import type { Presence, RequestKind, RoomNotice } from '@/lib/types';
import type { UrlParams } from '@/lib/url';

/** Label of the presence dot (DESIGN 9.10). */
export function presenceKey(p: Presence): TranslationKey {
  return `room.presence.${p}` as const;
}

/** Text of an incoming request toast (DESIGN 9.5, 9.7). */
export function requestKey(kind: RequestKind | 'rejoin'): TranslationKey {
  return `room.request.${kind}` as const;
}

/** Text of the pending state of this device's own request. */
export function pendingKey(kind: RequestKind): TranslationKey {
  return `room.pending.${kind}` as const;
}

/** Text of a manual-exchange problem. */
export function manualIssueKey(issue: ManualIssue): TranslationKey {
  return `room.manual.error.${issue}` as const;
}

/** The calm message that goes with `Connect manually`; null when no message is shown (`no-broker`). */
export function manualCauseKey(cause: ManualCause): TranslationKey | null {
  switch (cause) {
    case 'broker-unreachable':
      return 'room.notice.brokerUnreachable';
    case 'ice-failed':
      return 'room.notice.iceFailed';
    case 'timeout':
      return 'room.notice.noRoute';
    default:
      return null;
  }
}

/** Toast text of a room notice (DESIGN 9.5, 9.7, 9.10, 9.11). */
export function noticeKey(n: Pick<RoomNotice, 'kind' | 'request'>): TranslationKey {
  switch (n.kind) {
    case 'opponent-joined':
      return 'room.notice.opponentJoined';
    case 'opponent-connected':
      return 'room.notice.opponentConnected';
    case 'opponent-disconnected':
      return 'room.notice.opponentDisconnected';
    case 'reconnected':
      return 'room.notice.reconnected';
    case 'restored-from-opponent':
      return 'room.notice.restored';
    case 'sync-error':
      return 'room.notice.syncError';
    case 'version-mismatch':
      return 'room.notice.version';
    case 'rejoin-denied':
      return 'room.notice.rejoinDenied';
    case 'challenge-failed':
      return 'room.notice.challengeFailed';
    case 'request-declined':
      return `room.notice.declined.${n.request ?? 'draw'}` as const;
    case 'ice-failed':
    default:
      return 'room.notice.iceFailed';
  }
}

/**
 * The creator's room is open and nobody has joined yet: the invite sheet opens by itself
 * (DESIGN 9.2: the anchor "waits for a connection and shows the invite sheet").
 */
export function shouldOfferInvite(state: Pick<RoomState, 'seat' | 'lastSeenAt' | 'live' | 'phase'> | null): boolean {
  return !!state && state.seat === 0 && state.lastSeenAt === 0 && !state.live && state.phase !== 'read-only' && state.phase !== 'closed';
}

/**
 * This device holds no seat yet and waits as anchor for the opponent (DESIGN 9.5, last row: "The
 * returning device waits as anchor with `Waiting for opponent`"). Covers an invite link opened while
 * the creator's app is closed and a lost device returning while the survivor is offline. A seated
 * creator waiting for a joiner gets the invite sheet instead (`shouldOfferInvite`).
 */
export function waitsAsAnchor(state: Pick<RoomState, 'seat' | 'presence' | 'phase'> | null): boolean {
  return !!state && state.seat === null && state.presence === 'waiting' && state.phase === 'connecting';
}

/* ---------------------------------------------------------------------------------------------- */
/* `x` / `y` (DESIGN 13.2): manual signalling offer and answer, transient                          */
/* ---------------------------------------------------------------------------------------------- */

/** The manual signal a URL carries: `x` → `offer`, `y` → `answer` (url.ts parses them). */
export function signalOf(p: Pick<UrlParams, 'offer' | 'answer'>): { offer: string | null; answer: string | null } {
  return { offer: p.offer || null, answer: p.answer || null };
}

/**
 * `p` without `x` and `y`, for `useUrlParams().write` once the signal was used. (`write` keeps
 * the current `x` / `y` unless they are set; an empty string removes them.)
 */
export function withoutSignal(p: UrlParams): UrlParams {
  return { ...p, offer: '', answer: '' };
}
