/**
 * Test helpers for the board package (not shipped: only tests import this file).
 * jsdom has no PointerEvent and no layout, so tests install a PointerEvent built on MouseEvent
 * and give the grid a fixed 400 × 400 rect (50 px squares) at (0, 0).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { createStore, memoryStorage } from '@/lib/storage';
import type { Color, Square } from '@/lib/types';
import { squareCenter } from './geometry';

export const CELL = 50;
export const BOX = { left: 0, top: 0, width: CELL * 8, height: CELL * 8, right: CELL * 8, bottom: CELL * 8, x: 0, y: 0 };

/** Installs a minimal PointerEvent (MouseEvent + pointerId + pointerType) if jsdom lacks one. */
export function installPointerEvent(): void {
  if (typeof window.PointerEvent === 'function') return;
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
}

export function renderWithI18n(ui: ReactElement) {
  return render(
    <I18nProvider language="en" store={createStore(memoryStorage())}>
      {ui}
    </I18nProvider>,
  );
}

/** Gives the board grid a layout box so hit tests work. */
export function layoutGrid(): HTMLElement {
  const grid = screen.getByRole('grid');
  grid.getBoundingClientRect = () => BOX as DOMRect;
  return grid;
}

export const cell = (sq: Square): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-square="${sq}"]`);
  if (!el) throw new Error(`no cell ${sq}`);
  return el;
};

export function center(sq: Square, orientation: Color = 'w') {
  return squareCenter(sq, BOX, orientation);
}

type PointerOpts = { pointerType?: string; pointerId?: number };

/** A tap (pointerdown + pointerup) on a square. */
export function tap(sq: Square, o: PointerOpts = {}, orientation: Color = 'w') {
  const { x, y } = center(sq, orientation);
  const init = { pointerId: o.pointerId ?? 1, pointerType: o.pointerType ?? 'mouse', button: 0, clientX: x, clientY: y };
  fireEvent.pointerDown(cell(sq), init);
  fireEvent.pointerUp(cell(sq), init);
}

export function pointerDown(sq: Square, o: PointerOpts = {}, orientation: Color = 'w') {
  const { x, y } = center(sq, orientation);
  fireEvent.pointerDown(cell(sq), { pointerId: o.pointerId ?? 1, pointerType: o.pointerType ?? 'mouse', button: 0, clientX: x, clientY: y });
}

export function pointerMoveTo(x: number, y: number, o: PointerOpts = {}) {
  fireEvent.pointerMove(screen.getByRole('grid'), { pointerId: o.pointerId ?? 1, pointerType: o.pointerType ?? 'mouse', clientX: x, clientY: y });
}

export function pointerUpAt(x: number, y: number, o: PointerOpts = {}) {
  fireEvent.pointerUp(screen.getByRole('grid'), { pointerId: o.pointerId ?? 1, pointerType: o.pointerType ?? 'mouse', button: 0, clientX: x, clientY: y });
}

/** Drag a piece from one square to another with intermediate moves. */
export function drag(from: Square, to: Square, o: PointerOpts = {}, orientation: Color = 'w') {
  pointerDown(from, o, orientation);
  const a = center(from, orientation);
  const b = center(to, orientation);
  pointerMoveTo(a.x + 10, a.y + 10, o);
  pointerMoveTo(b.x, b.y, o);
  pointerUpAt(b.x, b.y, o);
}
