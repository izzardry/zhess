/**
 * Coach-mark tutorial (DESIGN 14.2, Ztyle 15): one overlay of floating bubbles placed next to
 * the things they explain, over the live game. Dismissed by tapping or clicking anywhere (or
 * any key). Bubbles enter staggered by 100 ms and fade out together in 400 ms.
 *
 * Content (DESIGN 14.2 plus the Ztyle template): back + saved, the game code, how to move
 * (tap or drag; type SAN on pointer devices), hold to underpromote, the toolbar (shield, bulb
 * tap/hold, flag tap/hold), tap the background to hide the UI. Portrait: 3 rows; mobile
 * landscape: 3 columns. Touch devices get the gesture texts, pointer devices click/type.
 *
 * Ported from Zudoku `TutorialOverlay.tsx`; fixes: dismiss runs once (Zudoku fired on both
 * touchstart and click), keyboard dismiss, dialog semantics, no hard-coded strings.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, EyeOff, Flag, Lightbulb, ShieldCheck } from 'lucide-react';
import { useIsTouchDevice } from '@/hooks/use-mobile';
import { useIsMobileLandscape } from '@/hooks/use-orientation';
import { useI18n } from '@/lib/i18n';
import type { Mode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { KnightGlyph } from './KnightGlyph';

export const TUTORIAL_EXIT_MS = 400;
const STAGGER_MS = 100;

export interface TutorialOverlayProps {
  /** Called once, after the fade-out. Pair with `useTutorial().completeTutorial`. */
  onDismiss: () => void;
  /** Toolbar contents follow the mode (DESIGN 4.2): no bulb in rooms, flag = resign only in pass-and-play. */
  mode?: Mode;
  /** Mobile landscape layout; detected when omitted. */
  isLandscape?: boolean;
  /** Touch texts; detected when omitted. */
  isTouch?: boolean;
}

function Bubble({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(id);
  }, [delay]);
  return (
    <div
      className={cn(
        'bg-card/95 backdrop-blur-sm rounded-xl px-4 py-3 shadow-xl border border-border text-sm max-w-[200px]',
        'transition-all duration-500 ease-out motion-reduce:transition-none',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Icon + short text row inside the toolbar bubble. */
function Row({ icon, text, small }: { icon: ReactNode; text: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-primary shrink-0 [&>svg]:w-3 [&>svg]:h-3" aria-hidden="true">
        {icon}
      </span>
      <span className={small ? 'text-[10px]' : 'text-xs'}>{text}</span>
    </div>
  );
}

/** A 3 × 3 corner of a board: a knight and the dot of its target (touch). */
function MoveIllustration() {
  const cells = Array.from({ length: 9 }, (_, i) => i);
  return (
    <div className="mx-auto my-2 grid grid-cols-3 w-[54px] h-[54px] rounded-sm overflow-hidden border border-border" aria-hidden="true">
      {cells.map((i) => {
        const r = Math.floor(i / 3);
        const c = i % 3;
        const dark = (r + c) % 2 === 1;
        return (
          <div
            key={i}
            className={cn('relative flex items-center justify-center bg-card', dark && 'bg-foreground/10', i === 6 && 'ring-2 ring-inset ring-foreground/50')}
          >
            {i === 6 && <KnightGlyph className="w-3.5 h-3.5 text-foreground" />}
            {i === 1 && <span className="w-1.5 h-1.5 rounded-full bg-foreground/40" />}
          </div>
        );
      })}
    </div>
  );
}

/** Keycaps for SAN typing (pointer devices). */
function KeysIllustration() {
  return (
    <div className="flex justify-center gap-1 mt-2" aria-hidden="true">
      {['e4', 'Nf3', '↵'].map((k) => (
        <kbd key={k} className="px-1.5 h-6 min-w-6 rounded border border-border bg-muted flex items-center justify-center font-mono text-xs">
          {k}
        </kbd>
      ))}
    </div>
  );
}

/** A mini promotion dial: Q at 12 o'clock, then R, B, N clockwise; the knight aimed. */
function DialIllustration() {
  const items = ['Q', 'R', 'B', 'N'];
  const radius = 22;
  return (
    <div className="relative w-[72px] h-[72px] mx-auto my-1" aria-hidden="true">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary/30" />
      {items.map((p, i) => {
        const angle = (i / items.length) * 2 * Math.PI - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        return (
          <div
            key={p}
            className={cn(
              'absolute w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-medium',
              p === 'N' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
            )}
            style={{ left: `calc(50% + ${x}px - 12px)`, top: `calc(50% + ${y}px - 12px)` }}
          >
            {p}
          </div>
        );
      })}
    </div>
  );
}

export function TutorialOverlay({ onDismiss, mode = 'computer', isLandscape, isTouch }: TutorialOverlayProps) {
  const { t } = useI18n();
  const detectedLandscape = useIsMobileLandscape();
  const detectedTouch = useIsTouchDevice();
  const landscape = isLandscape ?? detectedLandscape;
  const touch = isTouch ?? detectedTouch;

  const [exiting, setExiting] = useState(false);
  const done = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const dismiss = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setExiting(true);
    setTimeout(() => onDismissRef.current(), TUTORIAL_EXIT_MS);
  }, []);

  useEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const showHint = mode !== 'room';
  const flagText = mode === 'local' ? t('platform.tutorial.flagResign') : t('platform.tutorial.flag');

  const back = (
    <div className="flex items-start gap-2">
      <ArrowLeft className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <span className="font-medium text-xs">{t('platform.tutorial.backTitle')}</span>
        <p className="text-muted-foreground text-[10px] mt-0.5">{t('platform.tutorial.backBody')}</p>
      </div>
    </div>
  );
  const code = (
    <div>
      <span className="font-medium text-xs">{t('platform.tutorial.codeTitle')}</span>
      <p className="text-muted-foreground text-[10px] mt-0.5">{t('platform.tutorial.codeBody')}</p>
    </div>
  );
  const move = (
    <div className="text-center">
      <span className="font-medium text-sm">{t('platform.tutorial.moveTitle')}</span>
      <p className="text-muted-foreground text-xs mt-1">
        {touch ? t('platform.tutorial.moveTouch') : t('platform.tutorial.movePointer')}
      </p>
      {touch ? <MoveIllustration /> : <KeysIllustration />}
    </div>
  );
  const promote = (
    <div className="text-center">
      <span className="font-medium text-xs">{t('platform.tutorial.promoteTitle')}</span>
      <p className="text-muted-foreground text-[10px] mt-1">{t('platform.tutorial.promoteBody')}</p>
      <DialIllustration />
    </div>
  );
  const toolbar = (
    <div className="space-y-1.5">
      <Row icon={<ShieldCheck />} text={t('platform.tutorial.helpers')} small={landscape} />
      {showHint && <Row icon={<Lightbulb />} text={t('platform.tutorial.hint')} small={landscape} />}
      <Row icon={<Flag />} text={flagText} small={landscape} />
    </div>
  );
  const hide = (
    <div className="flex items-center gap-2">
      <EyeOff className="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
      <p className="text-muted-foreground text-[10px]">{t('platform.tutorial.hideUi')}</p>
    </div>
  );

  const overlay = (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('platform.tutorial.label')}
      tabIndex={-1}
      data-testid="tutorial-overlay"
      className={cn(
        'fixed inset-0 z-[100] outline-none select-none cursor-pointer transition-opacity [transition-duration:400ms]',
        exiting ? 'opacity-0' : 'opacity-100',
      )}
      onClick={dismiss}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />

      {!landscape ? (
        <div className="absolute inset-0 flex flex-col">
          <div className="flex justify-between items-start gap-3 px-4 pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))]">
            <Bubble delay={STAGGER_MS}>{back}</Bubble>
            <Bubble delay={2 * STAGGER_MS}>{code}</Bubble>
          </div>
          <div className="flex-1 flex items-center justify-center px-4 gap-3">
            <Bubble delay={3 * STAGGER_MS} className="max-w-[180px]">
              {move}
            </Bubble>
            <Bubble delay={4 * STAGGER_MS} className="max-w-[140px]">
              {promote}
            </Bubble>
          </div>
          <div className="flex justify-between items-end gap-3 px-4 pb-[max(5rem,calc(env(safe-area-inset-bottom)+4rem))]">
            <Bubble delay={5 * STAGGER_MS}>{hide}</Bubble>
            <Bubble delay={6 * STAGGER_MS}>{toolbar}</Bubble>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex">
          <div className="flex flex-col justify-between py-4 pl-[max(1rem,env(safe-area-inset-left))] w-1/4">
            <Bubble delay={STAGGER_MS}>{back}</Bubble>
            <Bubble delay={2 * STAGGER_MS}>{code}</Bubble>
          </div>
          <div className="flex-1 flex items-center justify-center gap-4">
            <Bubble delay={3 * STAGGER_MS} className="max-w-[180px]">
              {move}
            </Bubble>
            <Bubble delay={4 * STAGGER_MS} className="max-w-[140px]">
              {promote}
            </Bubble>
          </div>
          <div className="flex flex-col justify-between items-end py-4 pr-[max(1rem,env(safe-area-inset-right))] w-1/4">
            <Bubble delay={5 * STAGGER_MS} className="max-w-[160px]">
              {toolbar}
            </Bubble>
            <Bubble delay={6 * STAGGER_MS} className="max-w-[160px]">
              {hide}
            </Bubble>
          </div>
        </div>
      )}

      <div className="absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2">
        <p className="text-muted-foreground/60 text-[10px] whitespace-nowrap animate-pulse motion-reduce:animate-none">
          {t('platform.tutorial.tapToStart')}
        </p>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}
