import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { newGame, play } from '@/lib/zhess';
import type { Color, Game, Seating } from '@/lib/types';
import { ChessBoard } from './ChessBoard';
import type { BoardHighlights, Movable, Premove } from './types';
import {
  CELL,
  cell,
  center,
  drag,
  installPointerEvent,
  layoutGrid,
  pointerDown,
  pointerMoveTo,
  pointerUpAt,
  renderWithI18n,
  tap,
} from './test-helpers';

const PROMO_FEN = '7k/4P3/8/8/8/8/8/K7 w - - 0 1';
const CASTLE_FEN = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';

interface HarnessProps {
  start?: string;
  moves?: string[];
  orientation?: Color;
  helpers?: boolean;
  interactive?: boolean;
  movable?: Movable;
  seating?: Seating;
  premove?: Premove | null;
  highlights?: BoardHighlights;
  onMove?: (uci: string) => void;
  onPremove?: (pm: Premove | null) => void;
  /** Apply moves to the game like the real page does. */
  apply?: boolean;
}

function Harness({
  start,
  moves = [],
  orientation = 'w',
  helpers = true,
  interactive = true,
  movable = 'both',
  seating = 'side',
  premove = null,
  highlights,
  onMove = () => {},
  onPremove,
  apply = true,
}: HarnessProps) {
  const [game, setGame] = useState<Game>(() => moves.reduce((g, m) => play(g, m, 0), newGame(start)));
  return (
    <ChessBoard
      game={game}
      orientation={orientation}
      helpers={helpers}
      interactive={interactive}
      movable={movable}
      seating={seating}
      premove={premove}
      highlights={highlights}
      onPremove={onPremove}
      onMove={(uci) => {
        onMove(uci);
        if (apply) setGame((g) => play(g, uci, 0));
      }}
    />
  );
}

function setup(props: HarnessProps = {}) {
  const onMove = vi.fn();
  const onPremove = vi.fn();
  const utils = renderWithI18n(<Harness onMove={onMove} {...props} onPremove={props.onPremove ?? (props.movable === 'w' || props.movable === 'b' ? onPremove : undefined)} />);
  layoutGrid();
  return { ...utils, onMove, onPremove };
}

const markers = (kind: string) => Array.from(document.querySelectorAll(`[data-marker="${kind}"]`)).map((m) => m.closest('[data-square]')?.getAttribute('data-square'));

beforeAll(installPointerEvent);
afterEach(() => {
  vi.useRealTimers();
});

describe('ChessBoard: drawing and accessibility', () => {
  it('is a grid of 8 rows and 64 labelled gridcells', () => {
    setup();
    const grid = screen.getByRole('grid', { name: 'Chess board' });
    expect(within(grid).getAllByRole('row')).toHaveLength(8);
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(64);
    expect(screen.getByRole('gridcell', { name: 'white knight, g1' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'black queen, d8' })).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: 'e4' })).toBeInTheDocument();
  });

  it('draws white at the bottom, or black when oriented for black', () => {
    const { unmount } = setup();
    let cells = screen.getAllByRole('gridcell');
    expect(cells[0]).toHaveAttribute('data-square', 'a8');
    expect(cells[63]).toHaveAttribute('data-square', 'h1');
    unmount();
    setup({ orientation: 'b' });
    cells = screen.getAllByRole('gridcell');
    expect(cells[0]).toHaveAttribute('data-square', 'h1');
    expect(cells[63]).toHaveAttribute('data-square', 'a8');
  });

  it('rotates the far side’s pieces in face-to-face seating only', () => {
    const { unmount } = setup({ seating: 'face' });
    expect(cell('e8').querySelector('svg')).toHaveClass('rotate-180');
    expect(cell('e1').querySelector('svg')).not.toHaveClass('rotate-180');
    unmount();
    setup({ seating: 'side' });
    expect(cell('e8').querySelector('svg')).not.toHaveClass('rotate-180');
  });

  it('shows coordinates, last move and check only with helpers', () => {
    const moves = ['e2e4', 'f7f6', 'd2d4', 'g7g5', 'd1h5'];
    const { unmount } = setup({ moves });
    expect(cell('a1')).toHaveTextContent('1');
    expect(cell('h1')).toHaveTextContent('h');
    expect(cell('d1').dataset.state).toContain('last');
    expect(cell('e8').dataset.state).toContain('check');
    expect(screen.getByRole('gridcell', { name: 'black king, e8, in check' })).toBeInTheDocument();
    unmount();
    setup({ moves, helpers: false });
    expect(cell('a1')).not.toHaveTextContent('1');
    expect(cell('d1').dataset.state ?? '').not.toContain('last');
    expect(cell('e8').dataset.state ?? '').not.toContain('check');
  });

  it('announces each move in words in a polite live region', () => {
    setup();
    tap('g1');
    tap('f3');
    expect(screen.getByTestId('board-live')).toHaveTextContent('White: knight to f3');
    tap('e7');
    tap('e5');
    expect(screen.getByTestId('board-live')).toHaveTextContent('Black: pawn to e5');
  });
});

describe('ChessBoard: tap-tap', () => {
  it('plays a legal move and shows dots while a piece is selected', () => {
    const { onMove } = setup();
    tap('e2');
    expect(cell('e2')).toHaveAttribute('aria-selected', 'true');
    expect(markers('dot').sort()).toEqual(['e3', 'e4']);
    tap('e4');
    expect(onMove).toHaveBeenCalledWith('e2e4');
    expect(cell('e4').querySelector('[data-piece="wp"]')).toBeInTheDocument();
    expect(markers('dot')).toEqual([]);
  });

  it('ignores an illegal target and clears the selection', () => {
    const { onMove } = setup();
    tap('e2');
    tap('e5');
    expect(onMove).not.toHaveBeenCalled();
    expect(cell('e2')).not.toHaveAttribute('aria-selected');
  });

  it('does not select the side not to move; another own piece changes the selection; a second tap deselects', () => {
    setup();
    tap('e7');
    expect(cell('e7')).not.toHaveAttribute('aria-selected');
    tap('e2');
    tap('d2');
    expect(cell('d2')).toHaveAttribute('aria-selected', 'true');
    expect(cell('e2')).not.toHaveAttribute('aria-selected');
    tap('d2');
    expect(cell('d2')).not.toHaveAttribute('aria-selected');
  });

  it('shows a capture ring on capturable pieces', () => {
    setup({ moves: ['e2e4', 'd7d5'] });
    tap('e4');
    expect(markers('ring')).toEqual(['d5']);
    expect(screen.getByRole('gridcell', { name: /^black pawn, d5, possible capture/ })).toBeInTheDocument();
  });

  it('hides dots and rings with helpers off but still moves', () => {
    const { onMove } = setup({ helpers: false, moves: ['e2e4', 'd7d5'] });
    tap('e4');
    expect(markers('dot')).toEqual([]);
    expect(markers('ring')).toEqual([]);
    expect(cell('e4')).toHaveAttribute('aria-selected', 'true');
    tap('d5');
    expect(onMove).toHaveBeenCalledWith('e4d5');
  });

  it('accepts no input when not interactive', () => {
    const { onMove } = setup({ interactive: false });
    tap('e2');
    tap('e4');
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
  });

  it('only lets the movable side move', () => {
    const { onMove } = setup({ movable: 'b', onPremove: undefined });
    tap('e2');
    tap('e4');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears the selection on a press outside the board', () => {
    setup();
    tap('e2');
    fireEvent.pointerDown(document.body, { pointerId: 2 });
    expect(cell('e2')).not.toHaveAttribute('aria-selected');
  });
});

describe('ChessBoard: drag', () => {
  it('drags a piece to a legal square', () => {
    const { onMove } = setup();
    pointerDown('g1');
    const a = center('g1');
    pointerMoveTo(a.x + 20, a.y - 20);
    expect(screen.getByTestId('drag-ghost')).toBeInTheDocument();
    expect(cell('g1').querySelector('svg')).toHaveClass('opacity-30');
    const b = center('f3');
    pointerMoveTo(b.x, b.y);
    expect(cell('f3').querySelector('.ring-foreground\\/40')).toBeInTheDocument();
    pointerUpAt(b.x, b.y);
    expect(onMove).toHaveBeenCalledWith('g1f3');
    expect(screen.queryByTestId('drag-ghost')).toBeNull();
  });

  it('lifts the dragged piece above a finger', () => {
    setup();
    pointerDown('e2', { pointerType: 'touch' });
    pointerMoveTo(200, 200, { pointerType: 'touch' });
    const ghost = screen.getByTestId('drag-ghost');
    const top = parseFloat(ghost.style.top);
    const height = parseFloat(ghost.style.height);
    expect(top + height / 2).toBeLessThan(200 - CELL / 2);
    pointerUpAt(200, 200, { pointerType: 'touch' });
  });

  it('snaps back on an illegal drop without moving', () => {
    const { onMove } = setup();
    drag('e2', 'e5');
    expect(onMove).not.toHaveBeenCalled();
    expect(cell('e2').querySelector('[data-piece="wp"]')).toBeInTheDocument();
  });

  it('castles when the king is dropped on its own rook', () => {
    const { onMove } = setup({ start: CASTLE_FEN });
    drag('e1', 'h1');
    expect(onMove).toHaveBeenCalledWith('e1g1');
  });

  it('drags correctly on a board oriented for black', () => {
    const { onMove } = setup({ orientation: 'b', moves: ['e2e4'] });
    drag('g8', 'f6', {}, 'b');
    expect(onMove).toHaveBeenCalledWith('g8f6');
  });
});

describe('ChessBoard: keyboard', () => {
  it('moves the focus ring with arrows and plays with Enter', () => {
    const { onMove } = setup();
    const start = cell('e2');
    expect(start).toHaveAttribute('tabindex', '0');
    act(() => start.focus());
    fireEvent.keyDown(start, { key: 'Enter' });
    expect(cell('e2')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cell('e4'));
    expect(cell('e4')).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(onMove).toHaveBeenCalledWith('e2e4');
  });

  it('Escape clears the selection', () => {
    setup();
    act(() => cell('e2').focus());
    fireEvent.keyDown(cell('e2'), { key: 'Enter' });
    fireEvent.keyDown(cell('e2'), { key: 'Escape' });
    expect(cell('e2')).not.toHaveAttribute('aria-selected');
  });

  it('plays typed SAN on Enter, from anywhere on the page', () => {
    const { onMove } = setup();
    for (const key of ['N', 'f', '3']) fireEvent.keyDown(window, { key });
    expect(screen.getByTestId('board-typed')).toHaveTextContent('Nf3');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith('g1f3');
    expect(screen.queryByTestId('board-typed')).toBeNull();
  });

  it('plays typed SAN while the board has focus', () => {
    const { onMove } = setup();
    act(() => cell('e2').focus());
    for (const key of ['e', '4', 'Enter']) fireEvent.keyDown(document.activeElement!, { key });
    expect(onMove).toHaveBeenCalledWith('e2e4');
  });

  it('rejects an illegal typed move and never takes z', () => {
    const { onMove } = setup();
    fireEvent.keyDown(window, { key: 'z' });
    expect(screen.queryByTestId('board-typed')).toBeNull();
    for (const key of ['e', '5', 'Enter']) fireEvent.keyDown(window, { key });
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByTestId('board-typed')).toHaveTextContent('e5');
    expect(screen.getByTestId('board-typed')).toHaveClass('line-through');
  });

  it('ignores typing in an input field', () => {
    const { onMove } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    for (const key of ['e', '4', 'Enter']) fireEvent.keyDown(input, { key });
    expect(onMove).not.toHaveBeenCalled();
    input.remove();
  });

  it('accepts castling typed as o-o', () => {
    const { onMove } = setup({ start: CASTLE_FEN });
    for (const key of ['o', '-', 'o', 'Enter']) fireEvent.keyDown(window, { key });
    expect(onMove).toHaveBeenCalledWith('e1g1');
  });
});

describe('ChessBoard: promotion', () => {
  it('auto-queens on a plain tap-tap', () => {
    const { onMove } = setup({ start: PROMO_FEN });
    tap('e7');
    tap('e8');
    expect(onMove).toHaveBeenCalledWith('e7e8q');
  });

  it('auto-queens on a plain drop', () => {
    const { onMove } = setup({ start: PROMO_FEN });
    drag('e7', 'e8');
    expect(onMove).toHaveBeenCalledWith('e7e8q');
  });

  it('opens the dial after holding the dragged pawn 300 ms on the target, and chooses a knight', () => {
    vi.useFakeTimers();
    const { onMove } = setup({ start: PROMO_FEN });
    pointerDown('e7', { pointerType: 'touch' });
    const a = center('e7');
    const b = center('e8');
    pointerMoveTo(a.x + 5, a.y - 10, { pointerType: 'touch' });
    pointerMoveTo(b.x, b.y, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByTestId('promotion-dial')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const dial = screen.getByTestId('promotion-dial');
    expect(within(dial).getAllByRole('menuitem')).toHaveLength(5);
    // Knight sits at 9 o'clock; 70 px is in the commit zone.
    pointerMoveTo(b.x - 70, b.y, { pointerType: 'touch' });
    expect(within(dial).getByRole('menuitem', { name: 'knight' })).toHaveAttribute('data-aimed', 'true');
    expect(within(dial).getByRole('menuitem', { name: 'knight' })).toHaveClass('dial-item--commit');
    pointerUpAt(b.x - 70, b.y, { pointerType: 'touch' });
    expect(onMove).toHaveBeenCalledWith('e7e8n');
    expect(screen.queryByTestId('promotion-dial')).toBeNull();
  });

  it('opens the dial on a 300 ms long-press of the target in tap-tap; the aim zone commits too', () => {
    vi.useFakeTimers();
    const { onMove } = setup({ start: PROMO_FEN });
    tap('e7');
    pointerDown('e8');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('promotion-dial')).toBeInTheDocument();
    const b = center('e8');
    pointerMoveTo(b.x + 45, b.y); // rook at 3 o'clock, aim zone
    expect(screen.getByRole('menuitem', { name: 'rook' })).toHaveClass('dial-item--aim');
    pointerUpAt(b.x + 45, b.y);
    expect(onMove).toHaveBeenCalledWith('e7e8r');
  });

  it('cancels when released in the dial center', () => {
    vi.useFakeTimers();
    const { onMove } = setup({ start: PROMO_FEN });
    drag('e7', 'e7');
    pointerDown('e7');
    const b = center('e8');
    pointerMoveTo(b.x, b.y - 10);
    pointerMoveTo(b.x, b.y);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    pointerUpAt(b.x + 5, b.y);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('promotion-dial')).toBeNull();
  });

  it('opens the dial with Shift+Enter and chooses by key', () => {
    const { onMove } = setup({ start: PROMO_FEN });
    act(() => cell('e2').focus());
    // Walk the focus to e7, select, step to e8, Shift+Enter.
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cell('e7'));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', shiftKey: true });
    const dial = screen.getByTestId('promotion-dial');
    expect(document.activeElement).toBe(dial);
    fireEvent.keyDown(dial, { key: 'ArrowLeft' });
    expect(within(dial).getByRole('menuitem', { name: 'knight' })).toHaveAttribute('data-aimed', 'true');
    fireEvent.keyDown(dial, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith('e7e8n');
  });

  it('a dial item can be clicked', () => {
    const { onMove } = setup({ start: PROMO_FEN });
    act(() => cell('e7').focus());
    fireEvent.keyDown(cell('e7'), { key: 'Enter' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter', shiftKey: true });
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'bishop' }));
    expect(onMove).toHaveBeenCalledWith('e7e8b');
  });
});

describe('ChessBoard: premove and highlights', () => {
  it('queues a premove on the opponent’s turn and draws it dashed', () => {
    const onPremove = vi.fn();
    const { onMove } = setup({ movable: 'w', moves: ['e2e4'], onPremove });
    tap('d2');
    expect(markers('dot')).toContain('d4');
    tap('d4');
    expect(onMove).not.toHaveBeenCalled();
    expect(onPremove).toHaveBeenCalledWith({ from: 'd2', to: 'd4' });
  });

  it('draws a premove and cancels it on any tap', () => {
    const onPremove = vi.fn();
    setup({ movable: 'w', moves: ['e2e4'], onPremove, premove: { from: 'd2', to: 'd4' } });
    expect(markers('premove').sort()).toEqual(['d2', 'd4']);
    tap('a6');
    expect(onPremove).toHaveBeenCalledWith(null);
  });

  it('pulses hint squares, shades threats, and pulses a blunder only with helpers', () => {
    const highlights: BoardHighlights = { hint: ['g1'], threats: ['e3', 'f3'], blunder: 'e2' };
    const { unmount } = setup({ highlights });
    expect(cell('g1').querySelector('.animate-hint-pulse')).toBeInTheDocument();
    expect(document.activeElement).toBe(cell('g1'));
    expect(cell('e3').dataset.state).toContain('threat');
    expect(cell('e2').querySelector('svg')).toHaveClass('zhess-blunder');
    unmount();
    setup({ highlights, helpers: false });
    expect(cell('e2').querySelector('svg')).not.toHaveClass('zhess-blunder');
    expect(cell('g1').querySelector('.animate-hint-pulse')).toBeInTheDocument();
  });
});
