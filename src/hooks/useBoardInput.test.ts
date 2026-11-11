import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { newGame, play } from '@/lib/zhess';
import type { Game, Square } from '@/lib/types';
import { squareCenter } from '@/components/board/geometry';
import { isSanChar, normalizeTyped, useBoardInput, type BoardInputOptions } from './useBoardInput';

const BOX = { left: 0, top: 0, width: 400, height: 400 };

function opts(over: Partial<BoardInputOptions> = {}): BoardInputOptions {
  return {
    game: newGame(),
    orientation: 'w',
    interactive: true,
    movable: 'both',
    premove: null,
    onMove: vi.fn(),
    getBox: () => BOX,
    captureKeys: false,
    ...over,
  };
}

/** A fake React pointer event on a square (no DOM needed: hit tests use the box). */
function pe(sq: Square | null, over: Partial<{ x: number; y: number; type: string; id: number }> = {}) {
  const c = sq ? squareCenter(sq, BOX, 'w') : { x: over.x ?? 0, y: over.y ?? 0 };
  const el = document.createElement('div');
  return {
    target: el,
    currentTarget: el,
    clientX: over.x ?? c.x,
    clientY: over.y ?? c.y,
    pointerId: over.id ?? 1,
    pointerType: over.type ?? 'mouse',
    button: 0,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as PointerEvent<HTMLElement>;
}

function ke(key: string, extra: Partial<{ shiftKey: boolean; target: EventTarget }> = {}) {
  return {
    key,
    shiftKey: extra.shiftKey ?? false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: extra.target ?? document.body,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as KeyboardEvent<HTMLElement>;
}

const tap = (h: { current: ReturnType<typeof useBoardInput> }, sq: Square) => {
  act(() => h.current.gridHandlers.onPointerDown(pe(sq)));
  act(() => h.current.gridHandlers.onPointerUp(pe(sq)));
};

describe('isSanChar / normalizeTyped', () => {
  it('takes SAN characters and never z', () => {
    for (const c of ['a', 'h', '1', '8', 'x', 'N', 'B', 'R', 'Q', 'K', 'O', '0', '-', '=', '+', '#']) expect(isSanChar(c)).toBe(true);
    for (const c of ['z', 'Z', 'i', '9', ' ', 'Enter', 'Shift']) expect(isSanChar(c)).toBe(false);
  });

  it('normalizes lower-case and zero castling', () => {
    expect(normalizeTyped('o-o')).toBe('O-O');
    expect(normalizeTyped('0-0-0')).toBe('O-O-O');
    expect(normalizeTyped(' Nf3 ')).toBe('Nf3');
  });
});

describe('useBoardInput', () => {
  it('selects a movable piece and lists its targets', () => {
    const { result } = renderHook((o: BoardInputOptions) => useBoardInput(o), { initialProps: opts() });
    tap(result, 'g1');
    expect(result.current.selected).toBe('g1');
    expect([...result.current.targets.keys()].sort()).toEqual(['f3', 'h3']);
  });

  it('plays tap-tap through onMove and clears the selection', () => {
    const o = opts();
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    tap(result, 'e2');
    tap(result, 'e4');
    expect(o.onMove).toHaveBeenCalledWith('e2e4');
    expect(result.current.selected).toBeNull();
    expect(result.current.lastInput).toEqual({ kind: 'tap', uci: 'e2e4' });
  });

  it('marks the own rook as a hidden castling drop target', () => {
    const o = opts({ game: newGame('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1') });
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    tap(result, 'e1');
    expect(result.current.targets.get('h1')).toEqual({ uci: 'e1g1', capture: false, promotion: false, hidden: true });
    expect(result.current.targets.get('a1')?.uci).toBe('e1c1');
    expect(result.current.targets.get('g1')?.hidden).toBe(false);
  });

  it('drags with pointer moves and drops on the target', () => {
    const o = opts();
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    act(() => result.current.gridHandlers.onPointerDown(pe('b1')));
    const c = squareCenter('c3', BOX, 'w');
    act(() => result.current.gridHandlers.onPointerMove(pe(null, { x: c.x, y: c.y })));
    expect(result.current.drag).toMatchObject({ from: 'b1', over: 'c3' });
    act(() => result.current.gridHandlers.onPointerUp(pe(null, { x: c.x, y: c.y })));
    expect(o.onMove).toHaveBeenCalledWith('b1c3');
    expect(result.current.drag).toBeNull();
    expect(result.current.lastInput?.kind).toBe('drag');
  });

  it('ignores a second pointer while the first is down, and pointercancel ends the drag', () => {
    const o = opts();
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    act(() => result.current.gridHandlers.onPointerDown(pe('b1')));
    act(() => result.current.gridHandlers.onPointerDown(pe('g1', { id: 2 })));
    expect(result.current.selected).toBe('b1');
    act(() => result.current.gridHandlers.onPointerMove(pe('c3')));
    act(() => result.current.gridHandlers.onPointerCancel(pe('c3')));
    expect(result.current.drag).toBeNull();
    expect(o.onMove).not.toHaveBeenCalled();
  });

  it('offers premove targets on the opponent’s turn and reports a premove', () => {
    const onPremove = vi.fn();
    const game = play(newGame(), 'e2e4', 0);
    const o = opts({ game, movable: 'w', onPremove });
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    tap(result, 'f1');
    // Sliding pieces ignore blockers for premoves.
    expect(result.current.targets.has('a6')).toBe(true);
    expect(result.current.targets.get('a6')?.uci).toBeNull();
    tap(result, 'b5');
    expect(onPremove).toHaveBeenCalledWith({ from: 'f1', to: 'b5' });
    expect(o.onMove).not.toHaveBeenCalled();
  });

  it('cannot select the opponent’s pieces nor premove without onPremove', () => {
    const game: Game = play(newGame(), 'e2e4', 0);
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: opts({ game, movable: 'w' }) });
    tap(result, 'd2');
    expect(result.current.selected).toBeNull();
    tap(result, 'e7');
    expect(result.current.selected).toBeNull();
  });

  it('clears the selection when the selected piece stops being movable', () => {
    const o = opts();
    const { result, rerender } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    tap(result, 'e2');
    expect(result.current.selected).toBe('e2');
    rerender({ ...o, interactive: false });
    expect(result.current.selected).toBeNull();
  });

  it('keyboard: arrows move the cursor from the focused cell, Enter selects and drops', () => {
    const o = opts();
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    expect(result.current.cursor).toBe('e2');
    act(() => result.current.gridHandlers.onKeyDown(ke('Enter')));
    expect(result.current.selected).toBe('e2');
    act(() => result.current.gridHandlers.onKeyDown(ke('ArrowUp')));
    act(() => result.current.gridHandlers.onKeyDown(ke('ArrowUp')));
    expect(result.current.cursor).toBe('e4');
    act(() => result.current.gridHandlers.onKeyDown(ke('Enter')));
    expect(o.onMove).toHaveBeenCalledWith('e2e4');
  });

  it('keyboard: arrows follow the orientation and stop at the edge', () => {
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: opts({ orientation: 'b' }) });
    expect(result.current.cursor).toBe('e7');
    act(() => result.current.gridHandlers.onKeyDown(ke('ArrowUp')));
    expect(result.current.cursor).toBe('e6');
    act(() => result.current.gridHandlers.onKeyDown(ke('ArrowLeft')));
    expect(result.current.cursor).toBe('f6');
    act(() => result.current.gridHandlers.onKeyDown(ke('End')));
    expect(result.current.cursor).toBe('a6');
    act(() => result.current.gridHandlers.onKeyDown(ke('ArrowRight')));
    expect(result.current.cursor).toBe('a6');
  });

  it('typed SAN: builds, backspaces and submits', () => {
    const o = opts();
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    for (const k of ['N', 'f', '4', 'Backspace', '3']) act(() => result.current.gridHandlers.onKeyDown(ke(k)));
    expect(result.current.typed).toBe('Nf3');
    act(() => result.current.gridHandlers.onKeyDown(ke('Enter')));
    expect(o.onMove).toHaveBeenCalledWith('g1f3');
    expect(result.current.typed).toBe('');
    expect(result.current.lastInput).toEqual({ kind: 'san', uci: 'g1f3' });
  });

  it('typed SAN is refused when it is not this person’s turn', () => {
    const o = opts({ movable: 'b' });
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    for (const k of ['e', '4', 'Enter']) act(() => result.current.gridHandlers.onKeyDown(ke(k)));
    expect(o.onMove).not.toHaveBeenCalled();
    expect(result.current.typedError).toBe('e4');
  });

  it('listens on the window when captureKeys is set', () => {
    const o = opts({ captureKeys: true });
    renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    for (const key of ['d', '4', 'Enter']) act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key })));
    expect(o.onMove).toHaveBeenCalledWith('d2d4');
  });

  it('keyboard dial: Shift+Enter opens it on a promotion target; letters choose', () => {
    const o = opts({ game: newGame('7k/4P3/8/8/8/8/8/K7 w - - 0 1') });
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    act(() => result.current.setCursor('e7'));
    act(() => result.current.gridHandlers.onKeyDown(ke('Enter')));
    act(() => result.current.gridHandlers.onKeyDown(ke('ArrowUp')));
    act(() => result.current.gridHandlers.onKeyDown(ke('Enter', { shiftKey: true })));
    expect(result.current.dial).toMatchObject({ from: 'e7', to: 'e8', mode: 'keyboard', aim: 'q' });
    act(() => result.current.dialKeyDown(ke('ArrowRight')));
    expect(result.current.dial?.aim).toBe('r');
    act(() => result.current.dialKeyDown(ke('b')));
    expect(o.onMove).toHaveBeenCalledWith('e7e8b');
    expect(result.current.dial).toBeNull();
  });

  it('keyboard dial: Escape cancels without a move', () => {
    const o = opts({ game: newGame('7k/4P3/8/8/8/8/8/K7 w - - 0 1') });
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    act(() => result.current.setCursor('e7'));
    act(() => result.current.gridHandlers.onKeyDown(ke('Enter')));
    act(() => result.current.gridHandlers.onKeyDown(ke('ArrowUp')));
    act(() => result.current.gridHandlers.onKeyDown(ke(' ', { shiftKey: true })));
    act(() => result.current.dialKeyDown(ke('Escape')));
    expect(result.current.dial).toBeNull();
    expect(o.onMove).not.toHaveBeenCalled();
  });

  it('Escape and Enter cancel a queued premove', () => {
    const onPremove = vi.fn();
    const game = play(newGame(), 'e2e4', 0);
    const o = opts({ game, movable: 'w', onPremove, premove: { from: 'd2', to: 'd4' } });
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    act(() => result.current.gridHandlers.onKeyDown(ke('Escape')));
    expect(onPremove).toHaveBeenLastCalledWith(null);
    onPremove.mockClear();
    act(() => result.current.gridHandlers.onKeyDown(ke('Enter')));
    expect(onPremove).toHaveBeenLastCalledWith(null);
  });

  it('accepts no move when the game is over', () => {
    let g = newGame();
    for (const m of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) g = play(g, m, 0);
    const o = opts({ game: g });
    const { result } = renderHook((p: BoardInputOptions) => useBoardInput(p), { initialProps: o });
    tap(result, 'e2');
    expect(result.current.selected).toBeNull();
  });
});
