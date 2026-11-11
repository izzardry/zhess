import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DIAL_GEOMETRY, DIAL_INCREMENTS, DIAL_MINUTES } from '@/lib/clock';
import { I18nProvider } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import type { Language, TimeControl } from '@/lib/types';
import { ClockDial, type ClockDialProps } from './ClockDial';
import { captionSide, clampCenter, DIAL_EXTENT, DIAL_MARGIN } from './dialPlacement';

const wrap = (ui: ReactElement, language: Language = 'en') =>
  render(
    <I18nProvider language={language} store={createStore(memoryStorage())}>
      {ui}
    </I18nProvider>,
  );

const X = 500;
const Y = 400;

// jsdom has no PointerEvent; MouseEvents named like pointer events keep clientX / clientY.
const winPointer = (type: 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
  });
const down = (el: Element, x = X, y = Y) =>
  act(() => {
    fireEvent(el, new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  });

const dial = () => screen.getByTestId('clock-dial');
const item = (v: number) => dial().querySelector<HTMLElement>(`[data-value="${v}"]`)!;

function mount(props: Partial<ClockDialProps> = {}, language: Language = 'en') {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const utils = wrap(<ClockDial x={X} y={Y} onPick={onPick} onCancel={onCancel} {...props} />, language);
  return { ...utils, onPick, onCancel };
}

describe('ClockDial', () => {
  it('shows nine minute values clockwise from 12 o’clock, with the current one noted', () => {
    mount({ value: { baseMs: 5 * 60_000, incMs: 0 } });
    expect(dial()).toHaveAttribute('data-step', 'minutes');
    expect(dial()).toHaveAttribute('role', 'menu');
    const values = [...dial().querySelectorAll('[data-value]')].map((e) => Number(e.getAttribute('data-value')));
    expect(values).toEqual([...DIAL_MINUTES]);
    expect(item(5)).toHaveClass('dial-item--noted');
    expect(item(5)).toHaveAttribute('aria-checked', 'true');
    expect(item(10)).toHaveAttribute('aria-checked', 'false');
    expect(item(1)).toHaveAccessibleName('1 minute');
    expect(item(30)).toHaveAccessibleName('30 minutes');
    // 12 o'clock: the first item sits straight above the centre.
    expect(item(DIAL_MINUTES[0]).style.left).toBe('-20px');
    expect(item(DIAL_MINUTES[0]).style.top).toBe('-80px');
  });

  it('drag from the hold picks minutes, then a tap picks the increment', () => {
    const { onPick, onCancel } = mount({ dragging: true });
    // Straight right of the start point, 60 px: commit zone on item 2 (3 minutes).
    winPointer('pointermove', X + 45, Y);
    expect(item(DIAL_MINUTES[2])).toHaveClass('dial-item--aim');
    winPointer('pointermove', X + 60, Y);
    expect(item(DIAL_MINUTES[2])).toHaveClass('dial-item--commit');
    winPointer('pointerup', X + 60, Y);
    expect(dial()).toHaveAttribute('data-step', 'increment');
    const incs = [...dial().querySelectorAll('[data-value]')].map((e) => Number(e.getAttribute('data-value')));
    expect(incs).toEqual([...DIAL_INCREMENTS]);
    expect(item(2)).toHaveAccessibleName('Plus 2 seconds per move');
    expect(item(0)).toHaveAccessibleName('No increment');
    expect(item(0).textContent).toBe('+0');
    down(item(2));
    expect(onPick).toHaveBeenCalledWith('3+2');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('releasing in the aim zone also picks (the dial has no secondary action)', () => {
    const { onPick } = mount({ dragging: true });
    winPointer('pointermove', X, Y - 45);
    winPointer('pointerup', X, Y - 45);
    expect(dial()).toHaveAttribute('data-step', 'increment');
    // Second gesture: press the centre, drag down-left to item 6 (+15 at 240°), release.
    down(dial().querySelector('[data-part="cancel"]')!, X, Y);
    const a = (240 * Math.PI) / 180;
    winPointer('pointermove', X + Math.sin(a) * 70, Y - Math.cos(a) * 70);
    winPointer('pointerup', X + Math.sin(a) * 70, Y - Math.cos(a) * 70);
    expect(onPick).toHaveBeenCalledWith(`1+${DIAL_INCREMENTS[6]}`);
  });

  it('a hold released without moving keeps the dial open for taps', () => {
    const { onPick, onCancel } = mount({ dragging: true });
    winPointer('pointerup', X + 3, Y + 2);
    expect(onCancel).not.toHaveBeenCalled();
    down(item(10));
    down(item(5));
    expect(onPick).toHaveBeenCalledWith('10+5');
  });

  it('back on the centre after aiming cancels; so do × and a tap outside', () => {
    const a = mount({ dragging: true });
    winPointer('pointermove', X + 60, Y);
    winPointer('pointermove', X + 5, Y);
    winPointer('pointerup', X + 5, Y);
    expect(a.onCancel).toHaveBeenCalledTimes(1);
    expect(a.onPick).not.toHaveBeenCalled();
    a.unmount();

    const b = mount();
    const cancel = screen.getByRole('menuitem', { name: 'Cancel' });
    down(cancel);
    winPointer('pointerup', X, Y);
    expect(b.onCancel).toHaveBeenCalledTimes(1);
    b.unmount();

    const c = mount();
    down(screen.getByTestId('clock-dial-backdrop'), 10, 10);
    expect(c.onCancel).toHaveBeenCalledTimes(1);
  });

  it('the pointerdown that picks minutes does not also pick an increment', () => {
    const { onPick } = mount();
    const el = item(DIAL_MINUTES[0]);
    down(el);
    // The trailing click of that press lands on whatever is now at that spot.
    fireEvent.click(el);
    fireEvent.click(item(DIAL_INCREMENTS[0]), { detail: 1 });
    expect(onPick).not.toHaveBeenCalled();
    expect(dial()).toHaveAttribute('data-step', 'increment');
  });

  it('is keyboard accessible: focus in, arrows aim, Enter confirms, Backspace goes back, Escape cancels', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    const value: TimeControl = { baseMs: 5 * 60_000, incMs: 0 };
    const { onPick, onCancel, unmount } = mount({ value });
    expect(document.activeElement).toBe(dial());
    expect(dial()).toHaveAccessibleName('Custom clock: minutes');
    // First arrow aims at the current value, the next moves clockwise.
    fireEvent.keyDown(dial(), { key: 'ArrowRight' });
    expect(item(5)).toHaveClass('dial-item--aim');
    expect(dial()).toHaveAttribute('aria-activedescendant', `zhess-clock-dial-minutes-${DIAL_MINUTES.indexOf(5)}`);
    fireEvent.keyDown(dial(), { key: 'ArrowRight' });
    fireEvent.keyDown(dial(), { key: 'Enter' });
    expect(dial()).toHaveAttribute('data-step', 'increment');
    expect(dial()).toHaveAccessibleName('Custom clock: increment for 10 min');
    // Back to the minutes, change to 15, forward again.
    fireEvent.keyDown(dial(), { key: 'Backspace' });
    expect(dial()).toHaveAttribute('data-step', 'minutes');
    expect(item(10)).toHaveClass('dial-item--aim');
    fireEvent.keyDown(dial(), { key: 'ArrowRight' });
    fireEvent.keyDown(dial(), { key: ' ' });
    // Increments: first arrow aims at +0 (current), Left wraps to the last.
    fireEvent.keyDown(dial(), { key: 'ArrowRight' });
    fireEvent.keyDown(dial(), { key: 'ArrowLeft' });
    expect(item(DIAL_INCREMENTS[DIAL_INCREMENTS.length - 1])).toHaveClass('dial-item--aim');
    fireEvent.keyDown(dial(), { key: 'Home' });
    fireEvent.keyDown(dial(), { key: 'ArrowDown' });
    fireEvent.keyDown(dial(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('15+1');
    expect(onCancel).not.toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('Escape cancels; Enter without an aim takes the current value', () => {
    const a = mount();
    fireEvent.keyDown(dial(), { key: 'Escape' });
    expect(a.onCancel).toHaveBeenCalledTimes(1);
    a.unmount();
    const b = mount({ value: { baseMs: 3 * 60_000, incMs: 2000 } });
    fireEvent.keyDown(dial(), { key: 'Enter' });
    fireEvent.keyDown(dial(), { key: 'Enter' });
    expect(b.onPick).toHaveBeenCalledWith('3+2');
  });

  it('assistive-technology clicks (detail 0) work on items', () => {
    const { onPick } = mount();
    fireEvent.click(item(20), { detail: 0 });
    fireEvent.click(item(10), { detail: 0 });
    expect(onPick).toHaveBeenCalledWith('20+10');
  });

  it('is translated', () => {
    mount({}, 'de');
    expect(dial()).toHaveAccessibleName('Eigene Bedenkzeit: Minuten');
    expect(item(2)).toHaveAccessibleName('2 Minuten');
    expect(screen.getByRole('menuitem', { name: 'Abbrechen' })).toBeInTheDocument();
  });

  it('works as a controlled flow from a pill hold', () => {
    function Harness() {
      const [tc, setTc] = useState<string | null>('5+0');
      const [open, setOpen] = useState(true);
      return (
        <>
          <output data-testid="tc">{tc}</output>
          {open && (
            <ClockDial
              x={X}
              y={Y}
              dragging
              onPick={(v) => {
                setTc(v);
                setOpen(false);
              }}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    wrap(<Harness />);
    winPointer('pointermove', X, Y - 70);
    winPointer('pointerup', X, Y - 70);
    down(item(30));
    expect(screen.getByTestId('tc')).toHaveTextContent('1+30');
    expect(screen.queryByTestId('clock-dial')).toBeNull();
  });
});

describe('clampCenter', () => {
  const phone = { width: 390, height: 844 };

  it('keeps the dial and its caption inside a 390x844 screen when the pill sits near the bottom', () => {
    // The clock pill near the bottom of a phone (the hold point).
    const c = clampCenter(195, 790, phone);
    expect(c.x).toBe(195);
    // The caption's bottom edge (centre + radius + 36 + its height) stays ≥ 8 px above the edge.
    const captionBottom = c.y + DIAL_GEOMETRY.radius + 36 + 26;
    expect(captionBottom).toBeLessThanOrEqual(phone.height - DIAL_MARGIN);
    // So does a committed item popped out at 6 o'clock, at scale 1.6.
    expect(c.y + DIAL_GEOMETRY.popRadius + 32).toBeLessThanOrEqual(phone.height - DIAL_MARGIN);
    // The old clamp (innerHeight - 112 = 732) let the caption spill to ~852 px.
    expect(c.y).toBeLessThan(732);
    expect(c.y).toBe(phone.height - DIAL_EXTENT.bottom);
  });

  it('also clears the bottom safe area', () => {
    const c = clampCenter(195, 840, { ...phone, safeBottom: 34 });
    expect(c.y).toBe(phone.height - 34 - DIAL_EXTENT.bottom);
  });

  it('keeps the items inside the top and side edges with the margin', () => {
    const c = clampCenter(10, 5, phone);
    expect(c.x - DIAL_GEOMETRY.reach).toBeGreaterThanOrEqual(DIAL_MARGIN);
    expect(c.y - DIAL_GEOMETRY.reach).toBeGreaterThanOrEqual(DIAL_MARGIN);
    const r = clampCenter(385, 400, phone);
    expect(r.x + DIAL_GEOMETRY.reach).toBeLessThanOrEqual(phone.width - DIAL_MARGIN);
    expect(r.y).toBe(400);
  });

  it('leaves a hold alone where the dial fits, and an axis alone where the viewport is too small', () => {
    expect(clampCenter(500, 400, { width: 1280, height: 800 })).toEqual({ x: 500, y: 400 });
    expect(clampCenter(50, 50, { width: 100, height: 100 })).toEqual({ x: 50, y: 50 });
  });

  it('opens the dial at the clamped centre', () => {
    const before = { w: window.innerWidth, h: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    try {
      mount({ x: 195, y: 800 });
      expect(dial().style.top).toBe(`${844 - DIAL_EXTENT.bottom}px`);
      expect(dial().style.left).toBe('195px');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: before.w });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: before.h });
    }
  });

  it('puts the caption above the ring when the clamp pushed the dial off the pill (mobile landscape)', () => {
    // 844x390: the clock pill near the bottom edge; the dial is pushed up by ~100 px.
    const press = { x: 625, y: 352 };
    const c = clampCenter(press.x, press.y, { width: 844, height: 390 });
    expect(press.y - c.y).toBeGreaterThan(DIAL_GEOMETRY.radius);
    expect(captionSide(press, c)).toBe('above');
    // Portrait 390x844: the dial opens on the pill (pushed up only a little): caption below.
    const p = { x: 250, y: 735 };
    expect(captionSide(p, clampCenter(p.x, p.y, phone))).toBe('below');
    // Not pushed at all: below.
    expect(captionSide({ y: 400 }, { y: 400 })).toBe('below');
    // No room above the ring: stays below.
    expect(captionSide({ y: 300 }, { y: 100 })).toBe('below');
  });

  it('draws the caption above the ring, clear of the pill, in a short landscape viewport', () => {
    const before = { w: window.innerWidth, h: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 844 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 });
    try {
      mount({ x: 625, y: 352 });
      const cap = dial().querySelector('[data-part="caption"]') as HTMLElement;
      expect(cap).toHaveAttribute('data-side', 'above');
      const top = parseFloat(dial().style.top) + parseFloat(cap.style.top);
      // The caption's bottom edge is above the ring and far above the press point.
      expect(top).toBeLessThan(352 - DIAL_GEOMETRY.radius);
      expect(cap.style.transform).toContain('-100%');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: before.w });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: before.h });
    }
  });
});
