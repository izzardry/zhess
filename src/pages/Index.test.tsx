/**
 * The integrated stage (Integrator 1): start ⇄ game, pass-and-play, undo/redo, hidden chrome,
 * resign with undo, game over, history, review, continue from here and the Coming-soon room mode.
 * Computer mode is covered by Index.computer.test.tsx.
 * The real browser paths (drag, dial, reload, share) are covered by e2e/m1.spec.ts.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/lib/i18n';
import { encodeMoves } from '@/lib/zhess';
import type { Square } from '@/lib/types';
import { installPointerEvent, layoutGrid, tap } from '@/components/board/test-helpers';
import Index from './Index';

const MATE: [Square, Square][] = [
  ['e2', 'e4'],
  ['e7', 'e5'],
  ['f1', 'c4'],
  ['b8', 'c6'],
  ['d1', 'h5'],
  ['g8', 'f6'],
  ['h5', 'f7'],
];

function renderStage(path = '/') {
  return render(
    <I18nProvider language="en">
      <TooltipProvider>
        <Toaster />
        <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Index />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </I18nProvider>,
  );
}

const stage = () => screen.getByTestId('stage');
const cellName = (sq: Square) => screen.getByRole('grid').querySelector(`[data-square="${sq}"]`)?.getAttribute('aria-label');

function move(from: Square, to: Square) {
  layoutGrid();
  act(() => tap(from));
  act(() => tap(to));
}

function startTwoPlayers() {
  const value = () => screen.queryByText('Two players', { exact: true });
  for (let i = 0; i < 14 && !value(); i++) fireEvent.click(screen.getByRole('button', { name: 'Previous opponent' }));
  expect(value()).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  expect(stage()).toHaveAttribute('data-phase', 'playing');
}

const toolbarButton = (name: string | RegExp) => within(screen.getByRole('toolbar')).getByRole('button', { name });

beforeAll(() => {
  installPointerEvent();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('zhess:tutorial-seen', 'true');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Index stage', () => {
  it('shows the start screen with a blurred preview and the Start pill', () => {
    renderStage();
    expect(stage()).toHaveAttribute('data-phase', 'start');
    expect(screen.getByRole('heading', { name: 'ZHESS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByTestId('board-preview').firstElementChild).toHaveAttribute('data-blurred', 'true');
    // Default opponent: COMPUTER 5 MEDIUM (DESIGN 4.1).
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('answers ROOM with Coming soon until milestone 3', async () => {
    renderStage('/?o=r');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Coming soon')).toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-phase', 'start');
  });

  it('answers a room invite link with Coming soon', async () => {
    renderStage('/?s=K7QW2M&o=r&p=1');
    expect(await screen.findByText('Coming soon')).toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-phase', 'start');
  });

  it('plays pass-and-play with undo and redo from the toolbar and the keyboard', () => {
    renderStage();
    startTwoPlayers();
    expect(screen.getByTestId('board-preview').firstElementChild).toHaveAttribute('data-blurred', 'false');
    move('e2', 'e4');
    expect(cellName('e4')).toMatch(/^white pawn, e4/);
    move('e7', 'e5');
    expect(screen.getByTestId('board-live')).toHaveTextContent('Black: pawn to e5');

    fireEvent.click(toolbarButton('Undo'));
    expect(cellName('e7')).toMatch(/^black pawn, e7/);
    fireEvent.keyDown(window, { key: 'z' });
    expect(cellName('e2')).toMatch(/^white pawn, e2/);
    fireEvent.keyDown(window, { key: 'Z', shiftKey: true });
    expect(cellName('e4')).toMatch(/^white pawn, e4/);
    fireEvent.click(toolbarButton('Redo'));
    expect(cellName('e5')).toMatch(/^black pawn, e5/);
  });

  it('hides and shows the chrome when the empty stage is tapped', () => {
    renderStage();
    startTwoPlayers();
    const bar = screen.getByRole('toolbar');
    expect(bar).not.toHaveAttribute('aria-hidden');
    fireEvent.click(stage());
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    // The clocks stay: both timers are still there.
    expect(screen.getAllByRole('timer')).toHaveLength(2);
    fireEvent.click(stage());
    expect(bar).not.toHaveAttribute('aria-hidden');
  });

  it('switches seating face to face: the far side is drawn upside down', () => {
    renderStage();
    startTwoPlayers();
    const seat = within(screen.getByRole('toolbar')).getByRole('button', { name: /face to face|side by side/i });
    const before = document.querySelectorAll('.rotate-180').length;
    fireEvent.click(seat);
    const after = document.querySelectorAll('.rotate-180').length;
    expect(after).not.toBe(before);
  });

  it('resigns on a 500 ms hold and the toast takes it back', () => {
    vi.useFakeTimers();
    renderStage();
    startTwoPlayers();
    move('e2', 'e4');
    const flag = toolbarButton('Resign (hold)');
    fireEvent.pointerDown(flag, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerUp(flag, { button: 0, pointerId: 1 });
    // Black was to move, so black resigned; the toast offers Undo for 5 s.
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Black resigned'));
    expect(status).toBeDefined();
    expect(toolbarButton('Resign (hold)')).toBeDisabled();
    fireEvent.click(within(status!).getByRole('button', { name: 'Undo' }));
    expect(toolbarButton('Resign (hold)')).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("ends Scholar's Mate with White wins! and starts a new game", async () => {
    renderStage();
    startTwoPlayers();
    for (const [a, b] of MATE) move(a, b);
    const dialog = await screen.findByRole('dialog', { name: 'White wins!' }, { timeout: 3000 });
    expect(dialog).toHaveTextContent('2 players');
    fireEvent.click(within(dialog).getByRole('button', { name: 'New game' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(cellName('e2')).toMatch(/^white pawn, e2/);
  });

  it('lists the game in history after Back and resumes it', () => {
    renderStage();
    startTwoPlayers();
    move('e2', 'e4');
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(stage()).toHaveAttribute('data-phase', 'start');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    const card = screen.getByTestId('history-card');
    expect(card).toHaveTextContent('Black to move');
    fireEvent.click(card);
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(cellName('e4')).toMatch(/^white pawn, e4/);
  });

  it('opens a finished game link in review; steps; continues from here', () => {
    const m = encodeMoves(MATE.map(([a, b]) => ({ m: a + b, ms: 0 })));
    renderStage(`/?s=MATE01&p=1&o=l&m=${m}`);
    expect(stage()).toHaveAttribute('data-phase', 'review');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // At the mate there is nothing to continue.
    expect(within(screen.getByRole('toolbar')).queryByRole('button', { name: 'Continue from here' })).toBeNull();

    fireEvent.click(toolbarButton(/^Previous move/));
    expect(cellName('h5')).toMatch(/^white queen, h5/);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(cellName('f7')).toMatch(/^white queen, f7/);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.click(toolbarButton('Continue from here'));
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(cellName('h5')).toMatch(/^white queen, h5/);
    expect(within(screen.getByRole('group', { name: 'Game info' })).queryByText('MATE01')).toBeNull();
  });
});
