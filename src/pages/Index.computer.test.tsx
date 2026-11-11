/**
 * The integrated stage against the computer (Integrator 2), with a deterministic FakeEngine in
 * place of Stockfish: the Start pill waits for the engine, the computer replies (and moves first
 * as black), undo takes a full turn, the hint bulb, the blunder guard, draw offers, the clock
 * dial, premoves, flag fall, the donation prompt after the first win, and engine failure.
 * The real engine in a real browser is covered by e2e/m2.spec.ts.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { installPointerEvent, layoutGrid, tap } from '@/components/board/test-helpers';
import { setSharedEngine } from '@/hooks/useZhessEngine';
import { FakeEngine } from '@/lib/engine/fake';
import { I18nProvider } from '@/lib/i18n';
import { bankTurn } from '@/lib/turnBank';
import type { Color, Game, Square } from '@/lib/types';
import zhess, { encodeMoves } from '@/lib/zhess';
import Index from './Index';

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
const cellOf = (sq: Square) => screen.getByRole('grid').querySelector<HTMLElement>(`[data-square="${sq}"]`)!;
const cellName = (sq: Square) => cellOf(sq).getAttribute('aria-label');
const toolbarButton = (name: string | RegExp) => within(screen.getByRole('toolbar')).getByRole('button', { name });
const hintCells = () => Array.from(document.querySelectorAll<HTMLElement>('[data-state~="hint"]')).map((el) => el.dataset.square);

function move(from: Square, to: Square, orientation: Color = 'w') {
  layoutGrid();
  act(() => tap(from, {}, orientation));
  act(() => tap(to, {}, orientation));
}

const urlOf = (ucis: string[]) => encodeMoves(ucis.map((m) => ({ m, ms: 0 })));

/** A game of `plies` quiet moves (no capture, no repeated position, not over): past move 30 at 62. */
function quietGame(plies: number): Game {
  let g = zhess.newGame();
  const seen = new Set<string>();
  while (g.cursor < plies) {
    let next: Game | null = null;
    for (const m of zhess.legalMoves(g)) {
      if (m.captured) continue;
      const n = zhess.play(g, m.uci, 0);
      const key = n.fen.split(' ').slice(0, 4).join(' ');
      if (n.end || seen.has(key)) continue;
      seen.add(key);
      next = n;
      break;
    }
    if (!next) throw new Error('no quiet move');
    g = next;
  }
  return g;
}

let engine: FakeEngine;

beforeAll(() => {
  installPointerEvent();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('zhess:tutorial-seen', 'true');
  engine = new FakeEngine({ loadMs: 30 });
  setSharedEngine(engine);
});

afterEach(() => {
  vi.useRealTimers();
  setSharedEngine(null);
});

async function startComputer(path = '/?o=c&d=1&w=w') {
  renderStage(path);
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(stage()).toHaveAttribute('data-phase', 'playing'));
}

describe('Index stage against the computer', () => {
  it('waits for the engine with a spinner on the Start pill, then plays; the computer replies', async () => {
    renderStage('/?o=c&d=1&w=w');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    // Loading: spinner with progress, still on the start screen.
    const pill = screen.getByTestId('start-pill');
    expect(pill).toHaveAttribute('aria-busy', 'true');
    expect(within(pill).getByRole('progressbar')).toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-phase', 'start');
    await waitFor(() => expect(stage()).toHaveAttribute('data-phase', 'playing'));
    expect(stage()).toHaveAttribute('data-engine', 'ready');
    expect(screen.queryByText('Coming soon')).toBeNull();
    // The info pill names the level.
    expect(within(screen.getByRole('group', { name: 'Game info' })).getByText('1')).toBeInTheDocument();

    move('e2', 'e4');
    // The move goes through the blunder guard (async); then the computer answers after at least 400 ms.
    await waitFor(() => expect(screen.getByTestId('board-live')).toHaveTextContent(/^Black: /), { timeout: 2000 });
    expect(cellName('e4')).toMatch(/^white pawn, e4/);
    const best = engine.calls.filter((c) => c.method === 'bestMove');
    expect(best).toHaveLength(1);
    expect(best[0].args[1]).toBe(1);
  });

  it('as black, the computer moves first; undo takes back a full turn and redo replays it', async () => {
    await startComputer('/?o=c&d=1&w=b');
    // Board oriented for black; white moves first (a2a3 is the first legal move).
    await waitFor(() => expect(cellName('a3')).toMatch(/^white pawn, a3/), { timeout: 2000 });
    move('e7', 'e5', 'b');
    await waitFor(() => expect(cellName('a4')).toMatch(/^white pawn, a4/), { timeout: 2000 });

    fireEvent.click(toolbarButton('Take back your last move'));
    // Two plies: white's a3a4 and black's e7e5.
    expect(cellName('a3')).toMatch(/^white pawn, a3/);
    expect(cellName('e7')).toMatch(/^black pawn, e7/);
    fireEvent.click(toolbarButton('Redo'));
    expect(cellName('a4')).toMatch(/^white pawn, a4/);
    expect(cellName('e5')).toMatch(/^black pawn, e5/);
  });

  it('as black, undoing the first turn lets the computer move again', async () => {
    await startComputer('/?o=c&d=1&w=b');
    await waitFor(() => expect(cellName('a3')).toMatch(/^white pawn, a3/), { timeout: 2000 });
    move('e7', 'e5', 'b');
    await waitFor(() => expect(cellName('a4')).toMatch(/^white pawn, a4/), { timeout: 2000 });
    fireEvent.click(toolbarButton('Take back your last move'));
    fireEvent.click(toolbarButton('Take back your last move'));
    // Back to the start: the computer is to move and plays again.
    await waitFor(() => expect(cellName('a3')).toMatch(/^white pawn, a3/), { timeout: 2000 });
    expect(cellName('e7')).toMatch(/^black pawn, e7/);
  });

  it('hint: the first tap pulses the piece, the second its target; the game is marked assisted', async () => {
    await startComputer();
    fireEvent.click(toolbarButton(/^Hint/));
    await waitFor(() => expect(hintCells()).toHaveLength(1));
    const first = hintCells()[0];
    expect(first).toBe('a2');
    expect(screen.getByTestId('assist-live')).toHaveTextContent('Hint: move the piece on a2');
    fireEvent.click(toolbarButton(/^Hint/));
    await waitFor(() => expect(hintCells()).toEqual(['a3']));
    expect(engine.calls.filter((c) => c.method === 'multiPv')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(screen.getByTestId('history-card')).toContainElement(screen.getByRole('img', { name: 'Assisted' }));
  });

  it('hint works in pass-and-play too', async () => {
    renderStage('/?o=l');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    fireEvent.click(toolbarButton(/^Hint/));
    await waitFor(() => expect(hintCells()).toEqual(['a2']));
  });

  it('blunder guard: hanging the queen is refused once, with a red pulse, and accepted the second time', async () => {
    const plies = ['e2e4', 'e7e5', 'd1h5', 'b8c6'];
    const after = zhess.play(zhess.replay(plies.map((m) => ({ m, ms: 0 }))), 'h5h6', 0).fen;
    engine = new FakeEngine({ evals: (fen) => (fen === after ? { cp: 900 } : { cp: 20 }) });
    setSharedEngine(engine);
    renderStage(`/?s=BLUNDR&p=1&o=c&d=1&w=w&m=${urlOf(plies)}`);
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    // The turn's "before" evaluation loads the engine.
    await waitFor(() => expect(stage()).toHaveAttribute('data-engine', 'ready'));

    move('h5', 'h6');
    await waitFor(() => expect(cellOf('h5').querySelector('.zhess-blunder')).not.toBeNull());
    expect(cellName('h5')).toMatch(/^white queen, h5/);
    expect(cellName('h6')).toMatch(/^h6/);
    expect(screen.getByTestId('assist-live')).toHaveTextContent('looks like a blunder');

    move('h5', 'h6');
    await waitFor(() => expect(cellName('h6')).toMatch(/^white queen, h6/));
  });

  it('blunder guard is off with helpers off', async () => {
    localStorage.setItem('zhess:helpers', 'false');
    const plies = ['e2e4', 'e7e5', 'd1h5', 'b8c6'];
    renderStage(`/?s=BLUNDR&p=1&o=c&d=1&w=w&m=${urlOf(plies)}`);
    move('h5', 'h6');
    expect(cellName('h6')).toMatch(/^white queen, h6/);
  });

  it('a draw offer before move 30 is declined with a toast', async () => {
    await startComputer();
    fireEvent.click(toolbarButton('Offer a draw (hold to resign)'));
    expect(await screen.findByText('Declined')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a draw offer past move 30 at an even position is accepted', async () => {
    const g = quietGame(62);
    expect(g.end).toBeUndefined();
    engine = new FakeEngine({ evals: () => ({ cp: 10 }) });
    setSharedEngine(engine);
    const color = g.turn;
    renderStage(`/?s=DRAW01&p=1&o=c&d=1&w=${color}&m=${encodeMoves(g.plies)}`);
    fireEvent.click(toolbarButton('Offer a draw (hold to resign)'));
    expect(await screen.findByRole('dialog', { name: 'Draw' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('the clock pill hold opens the dial; a pick sets the custom time control', () => {
    vi.useFakeTimers();
    renderStage('/?o=c&d=1');
    const pill = screen.getByTestId('clock-pill');
    fireEvent.pointerDown(pill, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    act(() => vi.advanceTimersByTime(600));
    const dial = screen.getByTestId('clock-dial');
    expect(dial).toHaveAttribute('data-step', 'minutes');
    fireEvent.pointerUp(pill, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    // Minutes, then the increment, on the same dial.
    fireEvent.click(within(dial).getByRole('menuitemradio', { name: '20 minutes' }), { detail: 0 });
    fireEvent.click(within(screen.getByTestId('clock-dial')).getByRole('menuitemradio', { name: 'Plus 5 seconds per move' }), {
      detail: 0,
    });
    expect(screen.queryByTestId('clock-dial')).toBeNull();
    expect(screen.getByTestId('clock-pill')).toHaveAttribute('data-value', '20+5');
    expect(localStorage.getItem('zhess:clock')).toBe('"20+5"');
  });

  it('a 1+0 game: the flag falls and the overlay says Out of time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'performance', 'Date'] });
    const plies = ['e2e4', 'e7e5'];
    renderStage(`/?s=CLOCK1&p=1&o=c&d=1&w=w&t=1%2B0&m=${urlOf(plies)}`);
    const near = () => screen.getAllByRole('timer').find((el) => el.closest('[data-color="w"]'))!;
    expect(near()).toHaveTextContent('1:00');
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(near()).toHaveTextContent('0:55');
    await act(async () => {
      vi.advanceTimersByTime(56_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole('dialog', { name: 'Out of time' })).toBeInTheDocument();
  });

  it('a loss on time: the summary counts the flagged turn, and the loss tint sits in an isolated stage root', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'performance', 'Date'] });
    renderStage(`/?s=TINT01&p=1&o=c&d=1&w=w&t=1%2B0&m=${urlOf(['e2e4', 'e7e5'])}`);
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    const dialog = screen.getByRole('dialog', { name: 'Out of time' });
    // DESIGN 8.4 summary: the flagged turn's full minute is part of the duration (was 0:00).
    expect(dialog).toHaveTextContent('TINT01 • Level 1 • 1 move • 1:00');
    // The loss tint: a negative-z layer that only shows when its parent is a stacking context;
    // otherwise the opaque html/body backgrounds paint over it (e2e/m2.spec.ts checks the pixels).
    const tint = document.querySelector<HTMLElement>('[data-tint]')!;
    expect(tint).toHaveAttribute('data-tint', 'destructive');
    expect(tint).toHaveClass('completion-failure', '-z-10');
    expect(tint.parentElement).toHaveClass('isolate');
    expect(tint.parentElement).toContainElement(stage());
  });

  it('restores the time already spent on the turn after a reload', () => {
    const plies = ['e2e4', 'e7e5'];
    const g = zhess.replay(plies.map((m) => ({ m, ms: 0 })));
    const url = `/?s=BANK01&p=1&o=c&d=1&w=w&t=1%2B0&m=${urlOf(plies)}`;
    const first = renderStage(url);
    first.unmount();
    // As `pagehide` does: 20 s were spent on white's turn before the reload.
    bankTurn('BANK01', g, 20_000);
    renderStage(url);
    const near = screen.getAllByRole('timer').find((el) => el.closest('[data-color="w"]'))!;
    expect(near).toHaveTextContent(/^0:(40|39)$/);
  });

  it('Back banks the running turn and Resume continues it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'performance', 'Date'] });
    const plies = ['e2e4', 'e7e5'];
    renderStage(`/?s=BACK01&p=1&o=c&d=1&w=w&t=1%2B0&m=${urlOf(plies)}`);
    const near = () => screen.getAllByRole('timer').find((el) => el.closest('[data-color="w"]'))!;
    // 16 s: past the 15-second rule, so the opened link is stored and can be resumed.
    act(() => vi.advanceTimersByTime(16_000));
    expect(near()).toHaveTextContent('0:44');
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    act(() => vi.advanceTimersByTime(30_000));
    // Resume waits for the engine (a computer game), then opens the game.
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    expect(near()).toHaveTextContent(/^0:4[34]$/);
  });

  it('a premove queued in a timed game fires when the computer has moved', async () => {
    const slow = new FakeEngine({ delayMs: 300, moves: { [zhess.play(zhess.newGame(), 'e2e4', 0).fen]: 'e7e5' } });
    setSharedEngine(slow);
    const plies: string[] = [];
    renderStage(`/?s=PREMV1&p=1&o=c&d=1&w=w&t=5%2B0&m=${urlOf(plies)}`);
    move('e2', 'e4');
    await waitFor(() => expect(cellName('e4')).toMatch(/^white pawn, e4/));
    // Black (the computer) is thinking: queue g1f3.
    move('g1', 'f3');
    expect(cellOf('g1').getAttribute('data-state') ?? '').toContain('premove');
    await waitFor(() => expect(cellName('e5')).toMatch(/^black pawn, e5/), { timeout: 3000 });
    await waitFor(() => expect(cellName('f3')).toMatch(/^white knight, f3/));
  });

  it('a win against the computer shows Checkmate! and, the first time, the donation prompt', async () => {
    // Fool's mate reversed: the player is black and mates with Qh4#.
    const plies = ['f2f3', 'e7e5', 'g2g4'];
    renderStage(`/?s=WIN001&p=1&o=c&d=1&w=b&m=${urlOf(plies)}`);
    move('d8', 'h4', 'b');
    expect(await screen.findByRole('dialog', { name: 'Checkmate!' }, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText('Did you enjoy your first round?', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(localStorage.getItem('zhess:donation-shown')).toBe('true');
  });

  it('a loss against the computer shows Checkmate without the glyph', async () => {
    // Helpers off: the guard would (rightly) refuse 2. g4 the first time.
    localStorage.setItem('zhess:helpers', 'false');
    // The player (white) is mated by the scripted computer: 1. f3 e5 2. g4 Qh4#.
    const afterG4 = zhess.replay(['f2f3', 'e7e5', 'g2g4'].map((m) => ({ m, ms: 0 }))).fen;
    setSharedEngine(new FakeEngine({ moves: { [afterG4]: 'd8h4' } }));
    renderStage(`/?s=LOSS01&p=1&o=c&d=1&w=w&m=${urlOf(['f2f3', 'e7e5'])}`);
    move('g2', 'g4');
    expect(await screen.findByRole('dialog', { name: 'Checkmate' }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('Did you enjoy your first round?')).toBeNull();
  });

  it('an engine that cannot load keeps the start screen and shows a calm toast with Try again', async () => {
    setSharedEngine(new FakeEngine({ loadResult: 'fail' }));
    renderStage('/?o=c&d=1&w=w');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('The computer could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-phase', 'start');
  });
});
