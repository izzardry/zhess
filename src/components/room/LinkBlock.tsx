/**
 * A link to pass to the other device (DESIGN 9.2, 9.9): its QR code (drawn in the app, `lib/qr.ts`),
 * the link itself in a read-only field, and Copy / Share (native share sheet where it exists).
 * A link too long for a QR code (above version 25) is shown alone with a short note.
 */
import { Copy, Share2 } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { copyText, shareOrCopy, type ShareNavigator } from '@/components/game/share';
import { BRAND, useI18n } from '@/lib/i18n';
import { qrSvg } from '@/lib/qr';
import { cn } from '@/lib/utils';

export interface QrCodeProps {
  text: string;
  /** Accessible name of the image. */
  label: string;
  className?: string;
}

/** The QR code of `text` as SVG (dark modules on white, also in dark mode), or null if too long. */
export function QrCode({ text, label, className }: QrCodeProps) {
  const qr = useMemo(() => qrSvg(text), [text]);
  if (!qr) return null;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${qr.viewBox} ${qr.viewBox}`}
      shapeRendering="crispEdges"
      data-qr-version={qr.version}
      className={cn('block w-48 max-w-full aspect-square rounded-xl bg-white text-black', className)}
    >
      <path d={qr.path} fill="currentColor" />
    </svg>
  );
}

const defaultNav = (): ShareNavigator | undefined => (typeof navigator === 'undefined' ? undefined : navigator);

export interface LinkBlockProps {
  link: string;
  /** Text that goes with the link in the share sheet. */
  shareText: string;
  /** Draw the QR code. Default true. */
  qr?: boolean;
  /** Navigator for share and clipboard (tests pass a fake). */
  nav?: ShareNavigator;
  className?: string;
}

export function LinkBlock({ link, shareText, qr = true, nav, className }: LinkBlockProps) {
  const { t } = useI18n();
  const n = nav ?? defaultNav();
  const canShare = typeof n?.share === 'function';
  const hasQr = useMemo(() => qr && qrSvg(link) !== null, [qr, link]);

  const copy = async () => {
    if (await copyText(link, n)) toast.success(t('linkCopied'));
    else toast.error(t('game.copyFailed'));
  };
  const share = async () => {
    const outcome = await shareOrCopy({ title: BRAND.shareTitle, text: shareText, url: link }, n);
    if (outcome === 'copied') toast.success(t('linkCopiedClipboard'));
    else if (outcome === 'failed') toast.error(t('game.copyFailed'));
  };

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      {qr && (hasQr ? <QrCode text={link} label={t('room.invite.qr')} /> : <p className="text-xs text-muted-foreground text-center">{t('room.invite.noQr')}</p>)}
      <input
        readOnly
        value={link}
        aria-label={t('room.invite.link')}
        onFocus={(e) => e.currentTarget.select()}
        spellCheck={false}
        className="w-full min-w-0 rounded-lg border border-border bg-background/60 px-3 py-2 font-mono text-xs text-muted-foreground truncate focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex w-full gap-2">
        <button type="button" onClick={() => void copy()} className={cn(canShare ? 'btn-ghost' : 'btn-primary !px-4 !py-2 !text-xs', 'flex-1')}>
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          {t('room.invite.copy')}
        </button>
        {canShare && (
          <button type="button" onClick={() => void share()} className="btn-primary flex-1 !px-4 !py-2 !text-xs">
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t('share')}
          </button>
        )}
      </div>
    </div>
  );
}
