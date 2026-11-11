/**
 * Game chrome: Back (top left), Help (top right) and the toolbar (bottom pill in portrait, right
 * rail in mobile landscape). Ported from Zudoku's StatusBar with the slot table of DESIGN 4.2:
 *
 * | Slot     | computer            | local      | room               | review                       |
 * |----------|---------------------|------------|--------------------|------------------------------|
 * | Undo     | one full turn back  | one ply    | takeback request   | step back (hold: to start)   |
 * | Redo     | replay              | replay     | hidden             | step forward (hold: to end)  |
 * | Hint     | yes                 | yes        | hidden             | hidden                       |
 * | Helpers  | yes                 | yes        | yes                | yes                          |
 * | Seating  | hidden              | yes        | hidden             | flip board                   |
 * | Flag     | draw / hold: resign | hold: resign | draw / hold: resign | continue from here        |
 * | Share    | yes                 | yes        | invite link        | link or PGN                  |
 *
 * Presentational: the parent decides what each callback does (e.g. how far undo goes).
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  Flag,
  GitBranch,
  HelpCircle,
  Lightbulb,
  Loader2,
  Redo2,
  RefreshCcw,
  Share2,
  ShieldCheck,
  ShieldOff,
  Undo2,
} from 'lucide-react';
import { HOLD_MS, useLongPress } from '@/hooks/useLongPress';
import { useI18n } from '@/lib/i18n';
import type { Mode, Seating } from '@/lib/types';
import { cn } from '@/lib/utils';
import { SeatingButton } from './SeatingButton';
import { ShareMenu } from './ShareMenu';
import { ToolbarButton } from './ToolbarButton';

/** Toolbar mode: a play mode, or review of a finished game. */
export type ToolbarMode = Mode | 'review';

export interface HintControls {
  /** Tap: show the hint (first tap the piece, second tap its target). */
  onHint: () => void;
  /** Held 1 s: the threat peek starts… */
  onPeekStart: () => void;
  /** …and ends on release. */
  onPeekEnd: () => void;
  /** The engine is loading: the bulb becomes a spinner (Ztyle 09). */
  busy?: boolean;
  disabled?: boolean;
}

export interface StatusBarProps {
  mode: ToolbarMode;
  /** Chrome shown (false while the UI is hidden by a background tap or during a transition). */
  visible?: boolean;
  /** Mobile landscape: toolbar as a right rail, chrome hides sideways. */
  landscape?: boolean;

  onBack: () => void;
  onHelp: () => void;
  /** Help held 3 s: the easter egg (donation prompt). */
  onHelpHold?: () => void;

  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Review: undo held 500 ms jumps to the start. */
  onUndoHold?: () => void;
  /** Review: redo held 500 ms jumps to the end. */
  onRedoHold?: () => void;
  /** Room: a takeback request is outstanding (undo shows it and is disabled). */
  undoPending?: boolean;

  /** Hint bulb (computer and pass-and-play). Leave undefined to hide it (e.g. `flags.hint` off). */
  hint?: HintControls;

  helpers: boolean;
  onToggleHelpers: () => void;

  /** Pass-and-play seating. Both must be set for the seating button to show. */
  seating?: Seating;
  onToggleSeating?: () => void;
  /** Review: flip the board (the seating slot). */
  onFlip?: () => void;

  /** Tap on the flag (computer, room). Never called in pass-and-play. */
  onOfferDraw?: () => void;
  /** Flag held 500 ms (computer, room, pass-and-play). */
  onResign?: () => void;
  /** E.g. the game is over or the board is locked. */
  flagDisabled?: boolean;
  /** Room: this device's draw offer is outstanding (the flag shows it; hold still resigns). */
  flagPending?: boolean;
  /** Review: the flag slot becomes "continue from here". Undefined hides it. */
  onContinue?: () => void;

  /** Share the game link (or room invite). */
  onShare: () => void;
  /** Review: with this set, Share opens a menu with the link and `Copy PGN`. */
  onCopyPgn?: () => void;
}

/** Top of the landscape rail: below Help (top 1.5rem, 44 px on touch) with a small gap. */
const RAIL_TOP = 'calc(max(1.5rem, env(safe-area-inset-top)) + 2.75rem + 0.5rem)';

/** A request waits for the opponent (DESIGN 9.7): the icon pulses, like the waiting presence dot. */
const PENDING = 'animate-pulse motion-reduce:animate-none';

/** Floating chrome surface (Ztyle 06). */
const GLASS = 'bg-card/80 backdrop-blur-sm border border-border shadow-lg';

export function StatusBar(props: StatusBarProps) {
  const {
    mode,
    visible = true,
    landscape = false,
    onBack,
    onHelp,
    onHelpHold,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onUndoHold,
    onRedoHold,
    undoPending,
    hint,
    helpers,
    onToggleHelpers,
    seating,
    onToggleSeating,
    onFlip,
    onOfferDraw,
    onResign,
    flagDisabled,
    flagPending,
    onContinue,
    onShare,
    onCopyPgn,
  } = props;
  const { t } = useI18n();
  const review = mode === 'review';

  // Hidden chrome must not take focus: `inert` (not in React 18's attribute list, so set it on the node).
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (barRef.current) barRef.current.inert = !visible;
  }, [visible]);

  const help = useLongPress({
    ms: HOLD_MS.help,
    onLongPress: () => onHelpHold?.(),
    onClick: () => onHelp(),
    disabled: !onHelpHold,
  });

  /* ---- slots, in groups: history │ assist │ out ---- */

  const history: ReactNode[] = [];
  if (mode === 'room') {
    history.push(
      <ToolbarButton
        key="undo"
        label={undoPending ? t('game.takebackPending') : t('game.askTakeback')}
        icon={<Undo2 className={cn(undoPending && PENDING)} aria-hidden="true" />}
        onClick={onUndo}
        disabled={!canUndo || undoPending}
        data-slot="undo"
        data-pending={undoPending ? 'true' : undefined}
      />,
    );
  } else {
    history.push(
      <ToolbarButton
        key="undo"
        label={review ? t('game.stepBack') : mode === 'computer' ? t('game.undoTurn') : t('undo')}
        icon={<Undo2 aria-hidden="true" />}
        onClick={onUndo}
        disabled={!canUndo}
        hold={review && onUndoHold ? { ms: HOLD_MS.step, onHold: onUndoHold } : undefined}
        data-slot="undo"
      />,
      <ToolbarButton
        key="redo"
        label={review ? t('game.stepForward') : t('redo')}
        icon={<Redo2 aria-hidden="true" />}
        onClick={onRedo}
        disabled={!canRedo}
        hold={review && onRedoHold ? { ms: HOLD_MS.step, onHold: onRedoHold } : undefined}
        data-slot="redo"
      />,
    );
  }

  const assist: ReactNode[] = [];
  if ((mode === 'computer' || mode === 'local') && hint) {
    assist.push(
      <ToolbarButton
        key="hint"
        label={hint.busy ? t('game.hintLoading') : t('game.hint')}
        icon={hint.busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}
        onClick={hint.onHint}
        disabled={hint.disabled}
        hold={{ ms: HOLD_MS.hint, onHold: hint.onPeekStart, onHoldEnd: hint.onPeekEnd }}
        aria-busy={hint.busy || undefined}
        data-slot="hint"
      />,
    );
  }
  assist.push(
    <ToolbarButton
      key="helpers"
      label={helpers ? t('game.helpersOff') : t('game.helpersOn')}
      icon={helpers ? <ShieldCheck aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
      onClick={onToggleHelpers}
      className={cn(!helpers && 'text-muted-foreground/40')}
      data-slot="helpers"
      data-on={helpers ? 'true' : 'false'}
    />,
  );
  if (mode === 'local' && seating && onToggleSeating) {
    assist.push(<SeatingButton key="seating" seating={seating} onToggle={onToggleSeating} />);
  }
  if (review && onFlip) {
    assist.push(
      <ToolbarButton
        key="flip"
        label={t('game.flipBoard')}
        icon={<RefreshCcw aria-hidden="true" />}
        onClick={onFlip}
        data-slot="flip"
      />,
    );
  }

  const out: ReactNode[] = [];
  if (review) {
    if (onContinue) {
      out.push(
        <ToolbarButton
          key="flag"
          label={t('game.continueHere')}
          icon={<GitBranch aria-hidden="true" />}
          onClick={onContinue}
          data-slot="continue"
        />,
      );
    }
  } else if (onResign || onOfferDraw) {
    const local = mode === 'local';
    out.push(
      <ToolbarButton
        key="flag"
        label={local ? t('game.holdToResign') : flagPending ? t('game.drawPending') : t('game.drawOrResign')}
        icon={<Flag className={cn(flagPending && !local && PENDING)} aria-hidden="true" />}
        // Pass-and-play has no draw offer: the tap is ignored and the button only resigns (DESIGN 8.3).
        onClick={local ? undefined : onOfferDraw}
        hold={onResign ? { ms: HOLD_MS.flag, onHold: onResign } : undefined}
        disabled={flagDisabled}
        data-slot="flag"
        data-pending={flagPending && !local ? 'true' : undefined}
      />,
    );
  }

  const shareLabel = review && onCopyPgn ? t('game.shareMenu') : mode === 'room' ? t('game.shareInvite') : t('game.shareGame');
  if (review && onCopyPgn) {
    out.push(
      <ShareMenu
        key="share"
        side={landscape ? 'left' : 'top'}
        onShareLink={onShare}
        onCopyPgn={onCopyPgn}
        trigger={<ToolbarButton label={shareLabel} icon={<Share2 aria-hidden="true" />} data-slot="share" />}
      />,
    );
  } else {
    out.push(
      <ToolbarButton key="share" label={shareLabel} icon={<Share2 aria-hidden="true" />} onClick={onShare} data-slot="share" />,
    );
  }

  const groups = [history, assist, out].filter((g) => g.length > 0);
  const count = groups.reduce((n, g) => n + g.length, 0);
  const dividers = groups.length - 1;

  // Button size: 44 px where it fits (DESIGN 14.1), shrinking on narrow screens so the bar never
  // overflows. Overhead = bar padding and border, dividers, gaps (plus side insets in portrait).
  // Landscape: the rail starts below the top-right Help button (RAIL_TOP) and is centered when the
  // screen is tall enough, so it never runs under Help on a short phone in landscape.
  const railOverhead = 32 + 2 + dividers * 9 + (count - 1) * 2;
  const overhead = landscape ? railOverhead : 32 + 16 + 2 + dividers * 9 + (count - 1) * 2;
  const size = landscape
    ? `clamp(30px, calc((100dvh - ${RAIL_TOP} - 1rem - env(safe-area-inset-bottom) - ${overhead}px) / ${count}), 44px)`
    : `clamp(34px, calc((100vw - ${overhead}px) / ${count}), 44px)`;
  const railStyle: CSSProperties | undefined = landscape
    ? { top: `max(${RAIL_TOP}, calc(50% - (${count} * var(--tb) + ${railOverhead}px) / 2))` }
    : undefined;

  const divider = (key: string) => (
    <div key={key} aria-hidden="true" className={landscape ? 'h-px w-6 my-1 bg-border shrink-0' : 'w-px h-6 mx-1 bg-border shrink-0'} />
  );

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        aria-label={t('game.backToStart')}
        title={t('game.backToStart')}
        data-slot="back"
        tabIndex={visible ? undefined : -1}
        className={cn(
          'fixed z-overlay icon-button w-10 h-10 p-0 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11',
          'bg-card/80 backdrop-blur-sm shadow-md',
          'top-[max(1.5rem,env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))]',
          'transition-all duration-chrome ease-out',
          visible
            ? 'opacity-100 translate-x-0 translate-y-0'
            : landscape
              ? 'opacity-0 -translate-x-4 pointer-events-none'
              : 'opacity-0 -translate-y-4 pointer-events-none',
        )}
      >
        <ArrowLeft aria-hidden="true" />
      </button>

      <button
        type="button"
        aria-label={t('game.showHelp')}
        title={t('game.showHelp')}
        data-slot="help"
        tabIndex={visible ? undefined : -1}
        {...help}
        className={cn(
          'fixed z-chrome fab [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 select-none [-webkit-touch-callout:none]',
          'top-[max(1.5rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))]',
          'transition-all duration-chrome ease-out',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none',
        )}
      >
        <HelpCircle aria-hidden="true" />
      </button>

      <div
        role="toolbar"
        aria-label={t('game.toolbar')}
        aria-orientation={landscape ? 'vertical' : 'horizontal'}
        aria-hidden={visible ? undefined : true}
        ref={barRef}
        data-mode={mode}
        style={{ '--tb': size, ...railStyle } as CSSProperties}
        className={cn(
          'fixed z-chrome flex items-center gap-0.5 rounded-full',
          GLASS,
          'transition-[opacity,transform] duration-chrome ease-out',
          landscape
            ? 'flex-col px-1.5 py-4 right-[max(1rem,env(safe-area-inset-right))]'
            : 'px-2 py-1.5 left-1/2 -translate-x-1/2 bottom-[max(1rem,env(safe-area-inset-bottom))]',
          // hide toward the owning edge (Ztyle 07): bottom bar down, right rail right
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
          landscape ? (visible ? 'translate-x-0' : 'translate-x-4') : visible ? 'translate-y-0' : 'translate-y-4',
        )}
      >
        {groups.flatMap((g, i) => (i === 0 ? g : [divider(`d${i}`), ...g]))}
      </div>
    </>
  );
}
