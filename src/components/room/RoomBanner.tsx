/**
 * A calm card over the board for room states that last (DESIGN 9.12, 9.5, 9.11):
 *
 * - `This room is open in another tab` with `Use here` (take the room over from the other tab).
 * - Version mismatch with `Reload`.
 * - Rejoin declined.
 * - Waiting for the opponent to let this device in (after `joiningDelayMs`, so a first join that
 *   is welcomed at once does not flash it).
 *
 * Renders nothing in every other state. Default placement: centered over the stage; pass
 * `className` to place it elsewhere.
 */
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TabState } from '@/hooks/useRoom';
import { useI18n } from '@/lib/i18n';
import type { RoomPhase } from '@/lib/room';
import { cn } from '@/lib/utils';

export interface RoomBannerProps {
  tab: TabState;
  phase?: RoomPhase | null;
  /** `Use here` in the other-tab state. */
  onTakeOver?: () => void;
  /** `Reload` in the version state. Default `location.reload()`. */
  onReload?: () => void;
  /** Wait before showing the joining message. Default 1000 ms. */
  joiningDelayMs?: number;
  className?: string;
}

type Kind = 'other-tab' | 'version' | 'denied' | 'joining' | null;

function kindOf(tab: TabState, phase: RoomPhase | null | undefined): Kind {
  if (tab === 'other') return 'other-tab';
  if (tab !== 'owner') return null;
  if (phase === 'version') return 'version';
  if (phase === 'denied') return 'denied';
  if (phase === 'joining') return 'joining';
  return null;
}

export function RoomBanner({ tab, phase, onTakeOver, onReload, joiningDelayMs = 1000, className }: RoomBannerProps) {
  const { t } = useI18n();
  const kind = kindOf(tab, phase);
  const [joiningShown, setJoiningShown] = useState(false);

  useEffect(() => {
    if (kind !== 'joining') {
      setJoiningShown(false);
      return;
    }
    if (joiningDelayMs <= 0) {
      setJoiningShown(true);
      return;
    }
    const id = setTimeout(() => setJoiningShown(true), joiningDelayMs);
    return () => clearTimeout(id);
  }, [kind, joiningDelayMs]);

  if (!kind || (kind === 'joining' && !joiningShown)) return null;

  let text: string;
  let action: JSX.Element | null = null;
  switch (kind) {
    case 'other-tab':
      text = t('room.otherTab');
      if (onTakeOver)
        action = (
          <button type="button" onClick={onTakeOver} className="btn-ghost">
            {t('room.takeOver')}
          </button>
        );
      break;
    case 'version':
      text = t('room.version');
      action = (
        <button type="button" onClick={() => (onReload ?? (() => window.location.reload()))()} className="btn-ghost">
          {t('room.reload')}
        </button>
      );
      break;
    case 'denied':
      text = t('room.denied');
      break;
    default:
      text = t('room.joining');
  }

  return (
    <div
      role="status"
      data-room-banner={kind}
      className={cn(
        'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-chrome w-[min(calc(100vw-2rem),20rem)]',
        'bg-card/95 backdrop-blur-sm border border-border rounded-2xl shadow-xl px-4 py-4 text-center animate-fade-in',
        'flex flex-col items-center gap-3',
        className,
      )}
    >
      {kind === 'joining' && <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />}
      <p className="text-sm">{text}</p>
      {action}
    </div>
  );
}
