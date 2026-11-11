/**
 * Share actions with the right texts and confirmation toasts (DESIGN 13.2, Ztyle 09 system toasts).
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { BRAND, useI18n } from '@/lib/i18n';
import { copyText, shareOrCopy, type ShareNavigator, type ShareOutcome } from './share';

/** Which share text to use: room invite, a solo game, or a win against the computer. */
export type ShareKind = 'room' | 'solo' | 'win';

export interface ShareApi {
  /** Shares `url` with the text for `kind` (`level` for `win`); falls back to copying with a toast. */
  shareLink: (url: string, kind: ShareKind, level?: number) => Promise<ShareOutcome>;
  /** Copies PGN to the clipboard and confirms with a toast. Resolves true on success. */
  copyPgn: (pgn: string) => Promise<boolean>;
}

export function useShare(nav?: ShareNavigator): ShareApi {
  const { t } = useI18n();

  const shareLink = useCallback(
    async (url: string, kind: ShareKind, level?: number) => {
      const text =
        kind === 'room'
          ? t('game.shareText.room')
          : kind === 'win'
            ? t('game.shareText.win', { level: level ?? '' })
            : t('game.shareText.solo');
      const outcome = await shareOrCopy({ title: BRAND.shareTitle, text, url }, nav);
      if (outcome === 'copied') toast.success(t('linkCopiedClipboard'));
      else if (outcome === 'failed') toast.error(t('game.copyFailed'));
      return outcome;
    },
    [t, nav],
  );

  const copyPgn = useCallback(
    async (pgn: string) => {
      const ok = await copyText(pgn, nav);
      if (ok) toast.success(t('game.pgnCopied'));
      else toast.error(t('game.copyFailed'));
      return ok;
    },
    [t, nav],
  );

  return { shareLink, copyPgn };
}
