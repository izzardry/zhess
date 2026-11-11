import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusBar, type StatusBarProps } from './StatusBar';
import { renderWithI18n } from './testUtils';

function props(over: Partial<StatusBarProps> = {}): StatusBarProps {
  return {
    mode: 'computer',
    onBack: vi.fn(),
    onHelp: vi.fn(),
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    hint: { onHint: vi.fn(), onPeekStart: vi.fn(), onPeekEnd: vi.fn() },
    helpers: true,
    onToggleHelpers: vi.fn(),
    seating: 'face',
    onToggleSeating: vi.fn(),
    onFlip: vi.fn(),
    onOfferDraw: vi.fn(),
    onResign: vi.fn(),
    onContinue: vi.fn(),
    onShare: vi.fn(),
    ...over,
  };
}

const slots = () =>
  Array.from(screen.getByRole('toolbar').querySelectorAll('[data-slot]')).map((el) => el.getAttribute('data-slot'));

const down = (el: Element) => fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
const hold = (el: Element, ms: number) => {
  down(el);
  act(() => void vi.advanceTimersByTime(ms));
  fireEvent.pointerUp(el);
  fireEvent.click(el);
};

afterEach(() => vi.useRealTimers());

describe('StatusBar slots per mode (DESIGN 4.2)', () => {
  it('computer: undo redo │ hint helpers │ flag share', () => {
    renderWithI18n(<StatusBar {...props()} />);
    expect(slots()).toEqual(['undo', 'redo', 'hint', 'helpers', 'flag', 'share']);
    expect(screen.getByRole('button', { name: 'Take back your last move' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Offer a draw (hold to resign)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share game' })).toBeInTheDocument();
  });

  it('two players: adds seating; the flag only resigns', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local' })} />);
    expect(slots()).toEqual(['undo', 'redo', 'hint', 'helpers', 'seating', 'flag', 'share']);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resign (hold)' })).toBeInTheDocument();
  });

  it('room: takeback request, no redo, no hint, no seating, invite link', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'room' })} />);
    expect(slots()).toEqual(['undo', 'helpers', 'flag', 'share']);
    expect(screen.getByRole('button', { name: 'Ask for a takeback' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share invite link' })).toBeInTheDocument();
  });

  it('room, game over: the flag slot becomes Rematch, which pulses while the request waits', () => {
    const onRematch = vi.fn();
    const { rerender } = renderWithI18n(<StatusBar {...props({ mode: 'room', onRematch })} />);
    expect(slots()).toEqual(['undo', 'helpers', 'rematch', 'share']);
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(onRematch).toHaveBeenCalledTimes(1);
    rerender(<StatusBar {...props({ mode: 'room', onRematch, rematchPending: true })} />);
    const pending = screen.getByRole('button', { name: 'Rematch requested' });
    expect(pending).toHaveAttribute('data-pending', 'true');
    fireEvent.click(pending);
    expect(onRematch).toHaveBeenCalledTimes(2);
  });

  it('room: an outstanding takeback is shown and disables undo', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'room', undoPending: true })} />);
    expect(screen.getByRole('button', { name: 'Takeback requested' })).toBeDisabled();
  });

  it('room: an outstanding draw offer shows on the flag, which still resigns on hold (DESIGN 9.7)', () => {
    vi.useFakeTimers();
    const p = props({ mode: 'room', flagPending: true });
    renderWithI18n(<StatusBar {...p} />);
    const flag = screen.getByRole('button', { name: 'Draw offered (hold to resign)' });
    expect(flag).toBeEnabled();
    expect(flag).toHaveAttribute('data-pending', 'true');
    hold(flag, 500);
    expect(p.onResign).toHaveBeenCalledTimes(1);
  });

  it('pass-and-play ignores flagPending: the flag only resigns', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local', flagPending: true })} />);
    expect(screen.getByRole('button', { name: 'Resign (hold)' })).not.toHaveAttribute('data-pending');
  });

  it('review: stepping, flip, continue from here, share menu', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'review', onCopyPgn: vi.fn() })} />);
    expect(slots()).toEqual(['undo', 'redo', 'helpers', 'flip', 'continue', 'share']);
    expect(screen.getByRole('button', { name: 'Previous move (hold for the start)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next move (hold for the end)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue from here' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share link or PGN' })).toBeInTheDocument();
  });

  it('hides optional slots whose callbacks are missing', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local', hint: undefined, onToggleSeating: undefined })} />);
    expect(slots()).toEqual(['undo', 'redo', 'helpers', 'flag', 'share']);
    renderWithI18n(<StatusBar {...props({ mode: 'review', onContinue: undefined, onFlip: undefined })} />);
    expect(screen.getAllByRole('toolbar')[1].querySelectorAll('[data-slot="continue"], [data-slot="flip"]')).toHaveLength(0);
  });

  it('puts dividers between the groups only', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'room' })} />);
    const bar = screen.getByRole('toolbar');
    expect(bar.querySelectorAll('[aria-hidden="true"].bg-border')).toHaveLength(2);
  });
});

describe('StatusBar actions', () => {
  it('undo and redo call through and respect canUndo / canRedo', () => {
    const p = props({ canUndo: false });
    renderWithI18n(<StatusBar {...p} />);
    expect(screen.getByRole('button', { name: 'Take back your last move' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(p.onRedo).toHaveBeenCalledTimes(1);
  });

  it('flag: tap offers a draw, a 500 ms hold resigns (and offers nothing)', () => {
    vi.useFakeTimers();
    const p = props();
    renderWithI18n(<StatusBar {...p} />);
    const flag = screen.getByRole('button', { name: 'Offer a draw (hold to resign)' });
    down(flag);
    fireEvent.pointerUp(flag);
    fireEvent.click(flag);
    expect(p.onOfferDraw).toHaveBeenCalledTimes(1);
    hold(flag, 500);
    expect(p.onResign).toHaveBeenCalledTimes(1);
    expect(p.onOfferDraw).toHaveBeenCalledTimes(1);
  });

  it('pass-and-play: the flag tap is ignored, the hold resigns', () => {
    vi.useFakeTimers();
    const p = props({ mode: 'local' });
    renderWithI18n(<StatusBar {...p} />);
    const flag = screen.getByRole('button', { name: 'Resign (hold)' });
    fireEvent.click(flag);
    expect(p.onOfferDraw).not.toHaveBeenCalled();
    hold(flag, 500);
    expect(p.onResign).toHaveBeenCalledTimes(1);
  });

  it('flagDisabled disables the flag', () => {
    renderWithI18n(<StatusBar {...props({ flagDisabled: true })} />);
    expect(screen.getByRole('button', { name: 'Offer a draw (hold to resign)' })).toBeDisabled();
  });

  it('hint: tap hints, a 1 s hold peeks until release', () => {
    vi.useFakeTimers();
    const p = props();
    renderWithI18n(<StatusBar {...p} />);
    const bulb = screen.getByRole('button', { name: 'Hint (hold to see threats)' });
    fireEvent.click(bulb);
    expect(p.hint!.onHint).toHaveBeenCalledTimes(1);
    down(bulb);
    act(() => void vi.advanceTimersByTime(999));
    expect(p.hint!.onPeekStart).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(p.hint!.onPeekStart).toHaveBeenCalledTimes(1);
    expect(p.hint!.onPeekEnd).not.toHaveBeenCalled();
    fireEvent.pointerUp(bulb);
    fireEvent.click(bulb);
    expect(p.hint!.onPeekEnd).toHaveBeenCalledTimes(1);
    expect(p.hint!.onHint).toHaveBeenCalledTimes(1);
  });

  it('hint: shows a spinner while the engine loads', () => {
    renderWithI18n(<StatusBar {...props({ hint: { onHint: vi.fn(), onPeekStart: vi.fn(), onPeekEnd: vi.fn(), busy: true } })} />);
    const bulb = screen.getByRole('button', { name: 'Loading the engine' });
    expect(bulb).toHaveAttribute('aria-busy', 'true');
    expect(bulb.querySelector('.animate-spin')).not.toBeNull();
  });

  it('helpers: the label says what pressing does', () => {
    const p = props({ helpers: false });
    const { rerender } = renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn helpers on' }));
    expect(p.onToggleHelpers).toHaveBeenCalledTimes(1);
    rerender(<StatusBar {...p} helpers />);
    expect(screen.getByRole('button', { name: 'Turn helpers off' })).toBeInTheDocument();
  });

  it('seating toggle', () => {
    const p = props({ mode: 'local', seating: 'side' });
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seat players face to face' }));
    expect(p.onToggleSeating).toHaveBeenCalledTimes(1);
  });

  it('review: holding undo / redo jumps to start / end; tapping steps', () => {
    vi.useFakeTimers();
    const p = props({ mode: 'review', onUndoHold: vi.fn(), onRedoHold: vi.fn() });
    renderWithI18n(<StatusBar {...p} />);
    const back = screen.getByRole('button', { name: 'Previous move (hold for the start)' });
    const fwd = screen.getByRole('button', { name: 'Next move (hold for the end)' });
    fireEvent.click(back);
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    hold(back, 500);
    expect(p.onUndoHold).toHaveBeenCalledTimes(1);
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    hold(fwd, 500);
    expect(p.onRedoHold).toHaveBeenCalledTimes(1);
    expect(p.onRedo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Flip board' }));
    expect(p.onFlip).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Continue from here' }));
    expect(p.onContinue).toHaveBeenCalledTimes(1);
  });

  it('review share opens a menu with the link and Copy PGN', async () => {
    const p = props({ mode: 'review', onCopyPgn: vi.fn() });
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share link or PGN' }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy PGN' }));
    expect(p.onCopyPgn).toHaveBeenCalledTimes(1);
    expect(p.onShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share link or PGN' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Share link' }));
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it('share in play calls onShare directly', () => {
    const p = props();
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share game' }));
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it('back and help; holding help 3 s is the easter egg', () => {
    vi.useFakeTimers();
    const p = props({ onHelpHold: vi.fn() });
    renderWithI18n(<StatusBar {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to start' }));
    expect(p.onBack).toHaveBeenCalledTimes(1);
    const help = screen.getByRole('button', { name: 'Show help' });
    fireEvent.click(help);
    expect(p.onHelp).toHaveBeenCalledTimes(1);
    hold(help, 3000);
    expect(p.onHelpHold).toHaveBeenCalledTimes(1);
    expect(p.onHelp).toHaveBeenCalledTimes(1);
  });
});

describe('StatusBar layout', () => {
  it('portrait is a horizontal bar, landscape a vertical rail', () => {
    const { rerender } = renderWithI18n(<StatusBar {...props()} />);
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getByRole('toolbar').className).toContain('bottom-');
    rerender(<StatusBar {...props()} landscape />);
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-orientation', 'vertical');
    expect(screen.getByRole('toolbar').className).toContain('flex-col');
  });

  it('sizes buttons to fit: 44 px max, by the number of slots', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local' })} />);
    const tb = screen.getByRole('toolbar').style.getPropertyValue('--tb');
    expect(tb).toContain('/ 7');
    expect(tb).toContain('44px');
  });

  it('hidden chrome is out of reach: aria-hidden, inert, not focusable', () => {
    const { rerender } = renderWithI18n(<StatusBar {...props()} visible={false} />);
    const bar = screen.getByRole('toolbar', { hidden: true });
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect((bar as HTMLElement & { inert?: boolean }).inert).toBe(true);
    expect(bar.className).toContain('opacity-0');
    expect(screen.getByRole('button', { name: 'Back to start' })).toHaveAttribute('tabindex', '-1');
    rerender(<StatusBar {...props()} visible />);
    expect((screen.getByRole('toolbar') as HTMLElement & { inert?: boolean }).inert).toBe(false);
  });

  it('is translated', () => {
    renderWithI18n(<StatusBar {...props({ mode: 'local' })} />, 'de');
    expect(screen.getByRole('button', { name: 'Aufgeben (halten)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hilfen ausschalten' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Spielsteuerung' })).toBeInTheDocument();
  });
});
