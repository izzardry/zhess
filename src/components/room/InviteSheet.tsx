/**
 * Invite sheet (DESIGN 9.2, 9.10, 13.2): the room code, the invite link `?s=<CODE>&o=r` (never
 * moves, never the key) with its QR code, Copy and native Share, the opponent's presence, and the
 * `Connect manually` ghost button when the 10-second rule offers it (DESIGN 9.9).
 */
import { UserPlus } from 'lucide-react';
import type { ShareNavigator } from '@/components/game/share';
import type { ManualCause } from '@/hooks/useRoom';
import { useI18n } from '@/lib/i18n';
import type { Presence } from '@/lib/types';
import { roomShareUrl } from '@/lib/url';
import { LinkBlock } from './LinkBlock';
import { PresenceDot } from './PresenceDot';
import { Sheet } from './Sheet';
import { manualCauseKey, presenceKey } from './text';

export interface InviteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  /** The invite link. Default `roomShareUrl(code)` on this page's base. */
  link?: string;
  /** Opponent presence, shown as a status line. */
  presence?: Presence | null;
  /** Non-null: offer `Connect manually` (useRoom's `manualCause`). */
  manualCause?: ManualCause | null;
  onConnectManually?: () => void;
  nav?: ShareNavigator;
}

export function InviteSheet({ open, onOpenChange, code, link, presence, manualCause, onConnectManually, nav }: InviteSheetProps) {
  const { t } = useI18n();
  const url = link ?? roomShareUrl(code);
  const causeKey = manualCause ? manualCauseKey(manualCause) : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('room.invite.title')} description={t('room.invite.body')} icon={<UserPlus />} testId="invite-sheet">
      <div className="mt-4 flex flex-col items-center gap-3">
        <div className="font-mono text-2xl font-medium tracking-mark pl-[0.3em]" aria-label={`${t('gameCode')}: ${code}`}>
          {code}
        </div>
        <LinkBlock link={url} shareText={t('game.shareText.room')} nav={nav} />
        {presence && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <span aria-hidden="true">
              <PresenceDot presence={presence} />
            </span>
            <span>{t(presenceKey(presence))}</span>
          </div>
        )}
        {manualCause && onConnectManually && (
          <div className="flex w-full flex-col items-center gap-2 border-t border-border pt-3">
            {causeKey && <p className="text-xs text-muted-foreground text-center">{t(causeKey)}</p>}
            <button type="button" onClick={onConnectManually} className="btn-ghost">
              {t('room.connectManually')}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
