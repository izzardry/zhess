/**
 * The stage in room mode (Integrator 3): Start with ROOM creates the room of the shown code, an
 * invite link joins it, and the room chrome follows the controller (DESIGN 4.2, 9). The opponent is
 * a second device: a real room controller with its own store, joined to the stage's room through
 * 3B's memory broker (PLAN 7: room logic is tested over the memory transport, never PeerJS). The
 * app's PeerJS factory is replaced by that memory broker.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { installPointerEvent, layoutGrid, tap } from '@/components/board/test-helpers';
import { I18nProvider } from '@/lib/i18n';
import { createRoomController, type RoomControllerApi } from '@/lib/room';
import { createStore, memoryStorage } from '@/lib/storage';
import type { MemoryNetwork } from '@/lib/transport';
import type { Square } from '@/lib/types';
import Index from './Index';

const broker = vi.hoisted(() => ({ net: null as MemoryNetwork | null, fail: false }));

vi.mock('@/lib/transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/transport')>();
  return {
    ...real,
    // The app's broker is the memory network of the test (or a broker that cannot be reached).
    createPeerJsFactory: () => (code: string) =>
      broker.fail ? Promise.reject(new Error('broker unreachable')) : broker.net!.factory(code),
  };
});

const { createMemoryNetwork } = await import('@/lib/transport');

function renderStage(path: string) {
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
const toolbar = () => screen.getByRole('toolbar');
const cellName = (sq: Square) => screen.getByRole('grid').querySelector(`[data-square="${sq}"]`)?.getAttribute('aria-label');

function move(from: Square, to: Square) {
  layoutGrid();
  act(() => tap(from));
  act(() => tap(to));
}

/** The other device: a room controller with its own storage, dialing the stage's room. */
function opponent(code: string): RoomControllerApi {
  return createRoomController({ code, store: createStore(memoryStorage()), factory: broker.net!.factory });
}

let others: RoomControllerApi[] = [];

beforeAll(() => {
  installPointerEvent();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('zhess:tutorial-seen', 'true');
  localStorage.setItem('zhess:opponent', JSON.stringify({ mode: 'room' }));
  localStorage.setItem('zhess:color', JSON.stringify('w'));
  broker.net = createMemoryNetwork();
  broker.fail = false;
  others = [];
});

afterEach(() => {
  for (const o of others) o.leave();
});

describe('Index stage in a room', () => {
  it('creates the room, plays it through with the opponent, and asks for a rematch from the overlay', async () => {
    renderStage('/?s=RMS001');
    expect(stage()).toHaveAttribute('data-phase', 'start');
    expect(screen.queryByText('Coming soon')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(stage()).toHaveAttribute('data-phase', 'playing');

    // The creator's room is open: the invite sheet shows by itself (DESIGN 9.2).
    const invite = await screen.findByTestId('invite-sheet');
    expect(within(invite).getByText('RMS001')).toBeInTheDocument();
    expect((within(invite).getByRole('textbox', { name: 'Invite link' }) as HTMLInputElement).value).toMatch(/#\/\?s=RMS001&o=r$/);
    expect(localStorage.getItem('zhess:rooms')).toContain('RMS001');

    // The opponent joins: presence turns connected, the sheet closes, a toast says so.
    const other = opponent('RMS001');
    others.push(other);
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    await waitFor(() => expect(screen.queryByTestId('invite-sheet')).toBeNull());
    expect(await screen.findByText('Opponent joined')).toBeInTheDocument();
    expect(other.snapshot.color).toBe('b');

    // The room column of the toolbar (DESIGN 4.2): takeback request, no redo, no hint.
    const bar = toolbar();
    expect(bar).toHaveAttribute('data-mode', 'room');
    expect(within(bar).getByRole('button', { name: 'Ask for a takeback' })).toBeDisabled();
    expect(within(bar).queryByRole('button', { name: /redo/i })).toBeNull();
    expect(within(bar).queryByRole('button', { name: /hint/i })).toBeNull();
    // Info pill: presence dot and the room score.
    expect(screen.getByRole('button', { name: 'Opponent connected. Show invite' })).toBeInTheDocument();
    expect(screen.getByText('0 – 0')).toBeInTheDocument();

    // A move on the board goes to the room; the opponent's reply arrives.
    move('e2', 'e4');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(1));
    act(() => {
      expect(other.move('e7e5')).toBe(true);
    });
    await waitFor(() => expect(cellName('e5')).toMatch(/^black pawn/));
    // Room addresses never carry moves (DESIGN 13.2): the hook writes `?s=RMS001&p=1&o=r` only.

    // A draw offer arrives as a toast; Decline answers it.
    act(() => {
      expect(other.ask('draw')).toBe(true);
    });
    const offer = await screen.findByRole('alertdialog', { name: 'Your opponent offers a draw' });
    fireEvent.click(within(offer).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(other.snapshot.requests.outgoing).toBeUndefined());
    expect(other.snapshot.game.end).toBeUndefined();

    // Undo asks for a takeback; the button shows the pending state until the answer.
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Ask for a takeback' }));
    await waitFor(() => expect(other.snapshot.requests.incoming).toBe('takeback'));
    expect(within(toolbar()).getByRole('button', { name: 'Takeback requested' })).toBeDisabled();
    act(() => {
      expect(other.reply('takeback', true)).toBe(true);
    });
    await waitFor(() => expect(cellName('e4')).toBe('e4'));
    expect(cellName('e2')).toMatch(/^white pawn/);

    // The opponent resigns: the overlay says so and offers Rematch (DESIGN 8.4).
    act(() => {
      expect(other.resign()).toBe(true);
    });
    const over = await screen.findByRole('dialog', { name: /You won!/ }, { timeout: 4000 });
    fireEvent.click(within(over).getByRole('button', { name: 'Rematch' }));
    await waitFor(() => expect(other.snapshot.requests.incoming).toBe('rematch'));
    act(() => {
      expect(other.reply('rematch', true)).toBe(true);
    });
    // Game 2: colors swapped, the score from this device's side.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /You won!/ })).toBeNull());
    await waitFor(() => expect(other.snapshot.color).toBe('w'));
    expect(other.snapshot.n).toBe(2);
    expect(screen.getByText('1 – 0')).toBeInTheDocument();
    act(() => {
      expect(other.move('d2d4')).toBe(true);
    });
    await waitFor(() => expect(cellName('d4')).toMatch(/^white pawn/));

    // Share opens the invite sheet; the presence dot does too.
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Share invite link' }));
    expect(await screen.findByTestId('invite-sheet')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('invite-sheet')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('invite-sheet')).toBeNull());

    // Back leaves the room; the history lists both games with the game number and the score.
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(stage()).toHaveAttribute('data-phase', 'start');
    await waitFor(() => expect(other.snapshot.presence).not.toBe('connected'));
    const cards = await screen.findAllByTestId('history-card');
    expect(cards.map((c) => c.textContent)).toEqual([expect.stringMatching(/RMS001Game 21 – 0/), expect.stringMatching(/RMS001Game 11 – 0/)]);

    // Resuming the current game reconnects to the room.
    fireEvent.click(cards[0]);
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    expect(cellName('d4')).toMatch(/^white pawn/);
  });

  it('an invite link opens the room at once and joins it', async () => {
    // The host device (seat 0) creates the room with its own storage.
    const host = createRoomController({
      code: 'RMS002',
      store: createStore(memoryStorage()),
      factory: broker.net!.factory,
      create: { tc: null, color: 'b' },
    });
    others.push(host);
    renderStage('/?s=RMS002&o=r');
    expect(stage()).toHaveAttribute('data-phase', 'playing');
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    // The creator's color applies: this device plays white and moves first.
    expect(screen.queryByTestId('invite-sheet')).toBeNull();
    move('g1', 'f3');
    await waitFor(() => expect(host.snapshot.game.cursor).toBe(1));
  });

  it('offers Connect manually when the broker cannot be reached (DESIGN 9.9, 9.10)', async () => {
    broker.fail = true;
    renderStage('/?s=RMS003');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText('Could not reach the connection service.')).toBeInTheDocument();
    const invite = await screen.findByTestId('invite-sheet');
    fireEvent.click(within(invite).getByRole('button', { name: 'Connect manually' }));
    // jsdom has no WebRTC: the manual sheet says so calmly and offers to start over.
    const sheet = await screen.findByTestId('manual-sheet');
    expect(await within(sheet).findByText('This browser cannot open a direct connection.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Start over' })).toBeInTheDocument();
    expect(stage()).toHaveAttribute('data-room-cause', 'broker-unreachable');
  });

  it('a finished older room game opens in review; deleting a room game removes the room record with undo', async () => {
    renderStage('/?s=RMS004');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const other = opponent('RMS004');
    others.push(other);
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    act(() => {
      expect(other.resign()).toBe(true);
    });
    const over = await screen.findByRole('dialog', { name: /You won!/ }, { timeout: 4000 });
    fireEvent.click(within(over).getByRole('button', { name: 'Rematch' }));
    await waitFor(() => expect(other.snapshot.requests.incoming).toBe('rematch'));
    act(() => void other.reply('rematch', true));
    await waitFor(() => expect(other.snapshot.n).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));

    const cards = await screen.findAllByTestId('history-card');
    expect(cards).toHaveLength(2);
    // Game 1 (finished, not the current game) opens read-only in review, without connecting.
    fireEvent.click(cards[1]);
    expect(stage()).toHaveAttribute('data-phase', 'review');
    expect(stage()).not.toHaveAttribute('data-room-phase');
    expect(screen.getByText('1 – 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));

    // Delete game 2: the room record goes too; Undo brings both back.
    const card = (await screen.findAllByTestId('history-card'))[0];
    fireEvent.click(within(card.parentElement!).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(localStorage.getItem('zhess:rooms')).toBe('[]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(localStorage.getItem('zhess:rooms')).toContain('RMS004'));
    expect(await screen.findAllByTestId('history-card')).toHaveLength(2);
  });

  it('a timed room: the controller clock runs the strips, premoves fire, and a disconnect pauses (DESIGN 9.6, 9.8)', async () => {
    localStorage.setItem('zhess:clock', JSON.stringify('5+0'));
    renderStage('/?s=RMS005');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const other = opponent('RMS005');
    others.push(other);
    await waitFor(() => expect(stage()).toHaveAttribute('data-room-presence', 'connected'));
    const timer = (c: 'w' | 'b') => document.querySelector(`[data-color="${c}"] [role="timer"]`)!;
    expect(timer('w')).toHaveAttribute('aria-label', 'White clock');
    expect(timer('w').textContent).toBe('5:00');

    // Each side's first move is untimed; from white's second move on, white's clock runs.
    move('e2', 'e4');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(1));
    act(() => void other.move('e7e5', 1200));
    await waitFor(() => expect(cellName('e5')).toMatch(/^black pawn/));
    await waitFor(() => expect(timer('w')).toHaveAttribute('data-running', 'true'));
    move('g1', 'f3');
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(3));
    await waitFor(() => expect(timer('b')).toHaveAttribute('data-running', 'true'));

    // A premove while the opponent thinks: queued, then played when their move arrives (DESIGN 6.3).
    move('d2', 'd4');
    expect(cellName('d2')).toMatch(/^white pawn/);
    act(() => void other.move('b8c6', 900));
    await waitFor(() => expect(cellName('d4')).toMatch(/^white pawn/));
    await waitFor(() => expect(other.snapshot.game.cursor).toBe(5));
    expect(other.snapshot.game.plies[4].m).toBe('d2d4');

    // The opponent goes away: both clocks pause, the strips say so, the board locks (DESIGN 9.6).
    act(() => other.leave());
    await waitFor(() => expect(stage()).not.toHaveAttribute('data-room-presence', 'connected'));
    await waitFor(() => expect(screen.getAllByText('Paused')).toHaveLength(2));
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
    expect(timer('b')).not.toHaveAttribute('data-running');
  });
});
