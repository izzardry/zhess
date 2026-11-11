/**
 * Manual connection sheet (DESIGN 9.9): the two steps of the link exchange, for either side.
 *
 * - Host, step 1: the offer link (QR, Copy, Share) to send. Step 2: a paste field for the link
 *   the opponent sends back (opening that link on this device works too: the new tab hands it to
 *   this one over `BroadcastChannel`).
 * - Guest (opened an offer link), step 2: the answer link to send back, then waiting.
 * - Hand-over (a tab opened from an answer link): the result of passing it to the waiting tab,
 *   or the link to copy and paste when no tab took it.
 *
 * Driven entirely by useRoom's `ManualView`; the component holds only the paste field's text.
 */
import { Check, Link2, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import type { ShareNavigator } from '@/components/game/share';
import type { ManualIssue, ManualView } from '@/hooks/useRoom';
import { useI18n } from '@/lib/i18n';
import { LinkBlock } from './LinkBlock';
import { Sheet, SheetLabel } from './Sheet';
import { manualIssueKey } from './text';

export interface ManualConnectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manual: ManualView;
  /** Host step 2: applies a pasted answer; resolves null on success, else the problem. */
  onAcceptAnswer: (text: string) => Promise<ManualIssue | null>;
  /** Throws the exchange away and makes a new offer (host). */
  onStartOver: () => void;
  nav?: ShareNavigator;
}

function Busy({ text }: { text: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export function ManualConnectSheet({ open, onOpenChange, manual, onAcceptAnswer, onStartOver, nav }: ManualConnectSheetProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const inputId = useId();
  const errorId = useId();
  const lastLink = useRef(manual.link);

  // A new offer starts with an empty paste field.
  useEffect(() => {
    if (manual.link !== lastLink.current) {
      lastLink.current = manual.link;
      setText('');
    }
  }, [manual.link]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v || manual.busy) return;
    void onAcceptAnswer(v);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };
  // Pasting a whole link connects at once; typing waits for the button.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (pasted.trim() && !text.trim()) {
      e.preventDefault();
      setText(pasted.trim());
      submit(pasted);
    }
  };

  const signalText = t('room.manual.title');
  const handover = manual.step === 'handover';
  const title = handover ? t('room.manual.handover.title') : t('room.manual.title');
  const description = handover ? undefined : t('room.manual.intro');

  let body: JSX.Element;
  switch (manual.step) {
    case 'preparing':
      body = <Busy text={t('room.manual.preparing')} />;
      break;
    case 'offer':
    case 'connecting': {
      const connecting = manual.step === 'connecting';
      const error = manual.error;
      body = (
        <>
          <section aria-labelledby={`${inputId}-s1`} className="flex flex-col gap-2">
            <SheetLabel>{t('room.manual.step', { n: 1 })}</SheetLabel>
            <h3 id={`${inputId}-s1`} className="text-sm font-medium">
              {t('room.manual.host.send')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('room.manual.host.sendHint')}</p>
            {manual.link && <LinkBlock link={manual.link} shareText={signalText} nav={nav} />}
          </section>
          <section aria-labelledby={`${inputId}-s2`} className="flex flex-col gap-2 border-t border-border pt-3">
            <SheetLabel>{t('room.manual.step', { n: 2 })}</SheetLabel>
            <h3 id={`${inputId}-s2`} className="text-sm font-medium">
              {t('room.manual.host.paste')}
            </h3>
            {connecting ? (
              <Busy text={t('room.manual.connecting')} />
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-2">
                <label htmlFor={inputId} className="sr-only">
                  {t('room.manual.pasteLabel')}
                </label>
                <div className="flex gap-2">
                  <input
                    id={inputId}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onPaste={onPaste}
                    placeholder={t('room.manual.pastePlaceholder')}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    inputMode="url"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button type="submit" disabled={!text.trim() || manual.busy} className="btn-primary !px-4 !py-2 !text-xs disabled:opacity-30 disabled:cursor-not-allowed">
                    {manual.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                    {t('room.manual.connect')}
                  </button>
                </div>
                {error && (
                  <p id={errorId} role="alert" className="text-xs text-destructive">
                    {t(manualIssueKey(error))}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{t('room.manual.host.pasteHint')}</p>
              </form>
            )}
          </section>
        </>
      );
      break;
    }
    case 'answer':
      body = (
        <section aria-labelledby={`${inputId}-g`} className="flex flex-col gap-2">
          <SheetLabel>{t('room.manual.step', { n: 2 })}</SheetLabel>
          <h3 id={`${inputId}-g`} className="text-sm font-medium">
            {t('room.manual.guest.send')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('room.manual.guest.sendHint')}</p>
          {manual.link && <LinkBlock link={manual.link} shareText={signalText} nav={nav} />}
          <Busy text={t('room.manual.guest.waiting')} />
        </section>
      );
      break;
    case 'connected':
      body = (
        <div role="status" className="flex items-center justify-center gap-2 py-3 text-sm">
          <Check className="w-4 h-4 text-success" aria-hidden="true" />
          <span>{t('room.manual.connected')}</span>
        </div>
      );
      break;
    case 'handover':
      body =
        manual.handedOver === null ? (
          <Busy text={t('room.manual.handover.waiting')} />
        ) : manual.handedOver ? (
          <div role="status" className="flex items-center justify-center gap-2 py-3 text-sm text-center">
            <Check className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
            <span>{t('room.manual.handover.taken')}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">{t('room.manual.handover.paste')}</p>
            {manual.link && <LinkBlock link={manual.link} shareText={signalText} qr={false} nav={nav} />}
          </div>
        );
      break;
    case 'error':
      body = (
        <div className="flex flex-col items-center gap-3 py-2">
          <p role="alert" className="text-sm text-center">
            {t(manualIssueKey(manual.error ?? 'webrtc'))}
          </p>
          {manual.role === 'host' && (
            <button type="button" onClick={onStartOver} className="btn-ghost">
              {t('room.manual.startOver')}
            </button>
          )}
        </div>
      );
      break;
    default:
      body = <Busy text={t('room.manual.preparing')} />;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={description} icon={<Link2 />} testId="manual-sheet">
      <div className="mt-4 flex flex-col gap-3" data-step={manual.step}>
        {body}
      </div>
    </Sheet>
  );
}
