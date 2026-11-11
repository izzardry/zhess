/**
 * Custom time control dial (DESIGN 4.1, 6.4): opens on the 500 ms hold of the clock pill and picks
 * minutes, then increment, with the Ztyle radial dial (chapter 08) in the look of the promotion
 * dial (`components/board/PromotionDial.tsx`): 40 px items on a 60 px radius from 12 o'clock
 * clockwise, centre `×`, aim zone 40–55 px (accent, scale 1.6), commit zone ≥ 55 px (pops out to
 * 105 px and inverts), rubber band from the start point, portaled to `body`, clamped inside the
 * viewport. The current value of each step carries the "noted" ring.
 *
 * Gestures:
 * - Still holding after the pill's hold: drag and release on an item (aim or commit zone) picks it.
 *   Releasing where the hold started keeps the dial open for taps.
 * - Tap an item to pick it; press the centre and drag to aim again. Tap `×`, tap outside or press
 *   Escape to cancel.
 * - After the minutes the same dial shows the increments; the second pick calls `onPick`.
 *
 * Keyboard: focus moves into the dial; arrows aim (clockwise / counter-clockwise), Home / End,
 * Enter or Space confirm, Backspace returns to the minutes, Escape cancels. Focus goes back to
 * where it was on close.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CAPTION_GAP, clampCenter } from './dialPlacement';
import {
  DIAL_GEOMETRY,
  DIAL_INCREMENTS,
  DIAL_MINUTES,
  customTc,
  dialAim,
  dialItemOffset,
  nearestIndex,
  type DialZone,
} from '@/lib/clock';
import { useI18n } from '@/lib/i18n';
import type { TcString, TimeControl } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ClockDialProps {
  /** Where the hold happened, in viewport coordinates (`ClockPillAnchor.x / .y`). */
  readonly x: number;
  readonly y: number;
  /**
   * The pointer that held the pill is still down: drag-to-aim is live from the start (touch and
   * mouse). False when opened from the keyboard.
   */
  readonly dragging?: boolean;
  /** The current clock; its minutes and increment are marked and aimed first from the keyboard. */
  readonly value?: TimeControl;
  /** The custom time control was chosen, e.g. `20+5`. */
  readonly onPick: (tc: TcString) => void;
  /** Closed without a choice. */
  readonly onCancel: () => void;
}

type Step = 'minutes' | 'increment';

interface Drag {
  /** Start point of the gesture (offsets are measured from here). */
  readonly ox: number;
  readonly oy: number;
  /** Started by the pill's hold (a release without moving keeps the dial open). */
  readonly fromHold: boolean;
  /** The pointer has left the centre at some point. */
  moved: boolean;
}

export function ClockDial({ x, y, dragging = false, value = null, onPick, onCancel }: ClockDialProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('minutes');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [aim, setAim] = useState<{ zone: DialZone; index: number | null }>({ zone: 'center', index: null });
  const [band, setBand] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [center] = useState(() => clampCenter(x, y));
  const drag = useRef<Drag | null>(dragging ? { ox: x, oy: y, fromHold: true, moved: false } : null);
  const menu = useRef<HTMLDivElement>(null);

  const items = step === 'minutes' ? DIAL_MINUTES : DIAL_INCREMENTS;
  const n = items.length;
  const currentMinutes = value ? value.baseMs / 60000 : null;
  const currentInc = value ? value.incMs / 1000 : null;
  const noted = step === 'minutes' ? currentMinutes : currentInc;

  // Latest values for the window listeners.
  const live = useRef({ step, minutes, onPick, onCancel });
  live.current = { step, minutes, onPick, onCancel };

  const choose = useCallback((index: number) => {
    const { step: s, minutes: m, onPick: pick } = live.current;
    drag.current = null;
    setBand({ dx: 0, dy: 0 });
    if (s === 'minutes') {
      setMinutes(DIAL_MINUTES[index]);
      setStep('increment');
      setAim({ zone: 'center', index: null });
      return;
    }
    if (m !== null) pick(customTc(m, DIAL_INCREMENTS[index]));
  }, []);

  const cancel = useCallback(() => {
    drag.current = null;
    live.current.onCancel();
  }, []);

  /* ---- focus in on open, back out on close ---- */
  useLayoutEffect(() => {
    const before = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    menu.current?.focus({ preventScroll: true });
    return () => {
      if (before && typeof before.focus === 'function' && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  /* ---- drag-to-aim on the window (the pill's pointer may be captured by the pill) ---- */
  useEffect(() => {
    const move = (e: globalThis.PointerEvent | MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.ox;
      const dy = e.clientY - d.oy;
      const a = dialAim(dx, dy, live.current.step === 'minutes' ? DIAL_MINUTES.length : DIAL_INCREMENTS.length);
      if (a.zone !== 'center') d.moved = true;
      setAim(a);
      setBand({ dx, dy });
    };
    const up = (e: globalThis.PointerEvent | MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const a = dialAim(e.clientX - d.ox, e.clientY - d.oy, live.current.step === 'minutes' ? DIAL_MINUTES.length : DIAL_INCREMENTS.length);
      if (a.index !== null && (a.zone === 'aim' || a.zone === 'commit')) {
        choose(a.index);
        return;
      }
      drag.current = null;
      setBand({ dx: 0, dy: 0 });
      setAim({ zone: 'center', index: null });
      // Back on the centre after leaving it, or a tap on `×`: cancel. A plain hold release keeps it open.
      if (a.zone === 'center' && (d.moved || !d.fromHold)) cancel();
    };
    const stop = () => {
      drag.current = null;
      setBand({ dx: 0, dy: 0 });
    };
    // While aiming on touch, the page must not scroll (a scroll would cancel the pointer).
    const noScroll = (e: TouchEvent) => {
      if (drag.current && e.cancelable) e.preventDefault();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('touchmove', noScroll);
    };
  }, [choose, cancel]);

  /* ---- keyboard ---- */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const start = noted !== null ? nearestIndex(items, noted) : 0;
    const at = aim.index;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = at === null ? start : (at + 1) % n;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = at === null ? start : (at - 1 + n) % n;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        choose(at ?? start);
        return;
      case 'Backspace':
        e.preventDefault();
        if (step === 'increment') {
          setStep('minutes');
          setAim({ zone: 'aim', index: minutes !== null ? DIAL_MINUTES.indexOf(minutes) : null });
        }
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      case 'Tab':
        // Focus stays in the dial while it is open.
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    setAim({ zone: 'aim', index: next });
  };

  /* ---- pointer on the dial ---- */
  const onCenterDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { ox: e.clientX, oy: e.clientY, fromHold: false, moved: false };
    setAim({ zone: 'center', index: null });
  };

  const onItemDown = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    choose(index);
  };

  if (typeof document === 'undefined') return null;

  const label = (v: number): string =>
    step === 'minutes'
      ? v === 1
        ? t('clock.minuteOne')
        : t('clock.minutes', { n: v })
      : v === 0
        ? t('clock.incrementNone')
        : v === 1
          ? t('clock.incrementOne')
          : t('clock.increment', { n: v });
  const title = step === 'minutes' ? t('clock.dialMinutesTitle') : t('clock.dialIncrementTitle', { minutes: minutes ?? '' });
  const { radius, popRadius } = DIAL_GEOMETRY;
  // The band is drawn from the gesture start; in the dial's frame that is the start minus the centre.
  const d = drag.current;
  const bx = d ? d.ox - center.x : 0;
  const by = d ? d.oy - center.y : 0;

  return createPortal(
    <>
      <div
        aria-hidden
        data-testid="clock-dial-backdrop"
        className="fixed inset-0 z-overlay touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          if (!drag.current) cancel();
        }}
      />
      <div
        ref={menu}
        role="menu"
        aria-label={title}
        aria-description={t('clock.dialKeys')}
        aria-activedescendant={aim.index !== null ? `zhess-clock-dial-${step}-${aim.index}` : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="clock-dial"
        data-step={step}
        data-zhess-dial=""
        className="fixed z-overlay touch-none select-none outline-none animate-scale-in"
        style={{ left: center.x, top: center.y, width: 0, height: 0 }}
      >
        {(band.dx !== 0 || band.dy !== 0) && (
          <svg
            className="pointer-events-none absolute text-foreground"
            style={{ left: bx, top: by, overflow: 'visible' }}
            width="1"
            height="1"
            aria-hidden
          >
            <line x1="0" y1="0" x2={band.dx} y2={band.dy} stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" strokeLinecap="round" />
          </svg>
        )}
        <span
          aria-hidden
          data-part="caption"
          className="pointer-events-none absolute whitespace-nowrap rounded-full border border-foreground/10 bg-card/90 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shadow-sm"
          style={{ left: 0, top: radius + CAPTION_GAP, transform: 'translateX(-50%)' }}
        >
          {step === 'minutes' ? t('clock.dialMinutesCaption') : `${minutes}+ · ${t('clock.dialIncrementCaption')}`}
        </span>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-label={t('clock.dialCancel')}
          data-part="cancel"
          onPointerDown={onCenterDown}
          onClick={(e) => {
            // Keyboard or assistive-technology activation only (detail 0); pointers use the drag path.
            if (e.detail === 0) cancel();
          }}
          className={cn('dial-item cursor-pointer font-mono', aim.zone === 'center' && drag.current && 'dial-item--commit')}
          style={{ left: -20, top: -20 }}
        >
          <span aria-hidden>×</span>
        </button>
        {items.map((v, i) => {
          const hovered = aim.index === i && aim.zone !== 'center' && aim.zone !== 'none';
          const commit = hovered && aim.zone === 'commit';
          const pos = dialItemOffset(i, n, commit ? popRadius : radius);
          const isNoted = noted !== null && Math.abs(noted - v) < 1e-9;
          return (
            <button
              // A new key per step: the pointerdown that picked the minutes must not click an increment.
              key={`${step}-${v}`}
              id={`zhess-clock-dial-${step}-${i}`}
              type="button"
              role="menuitemradio"
              aria-checked={isNoted}
              tabIndex={-1}
              aria-label={label(v)}
              data-value={v}
              data-aimed={hovered || undefined}
              onPointerDown={onItemDown(i)}
              onClick={(e) => {
                if (e.detail === 0) choose(i);
              }}
              className={cn(
                'dial-item cursor-pointer font-mono tabular-nums',
                isNoted && !hovered && 'dial-item--noted',
                hovered && !commit && 'dial-item--aim',
                commit && 'dial-item--commit',
              )}
              style={{
                left: pos.x - 20,
                top: pos.y - 20,
                transform: hovered ? 'scale(1.6)' : 'scale(1)',
                zIndex: hovered ? 1 : undefined,
              }}
            >
              {step === 'minutes' ? v : `+${v}`}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
