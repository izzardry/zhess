import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameOverOverlay, PageTint, type GameOverOverlayProps } from './GameOverOverlay';
import { renderWithI18n } from './testUtils';

function props(over: Partial<GameOverOverlayProps> = {}): GameOverOverlayProps {
  return {
    open: true,
    end: { result: '1-0', by: 'mate' },
    mode: 'computer',
    myColor: 'w',
    code: 'K7QW2M',
    level: 5,
    plies: 67,
    durationMs: 728_000,
    onShare: vi.fn(),
    onPrimary: vi.fn(),
    onDismiss: vi.fn(),
    delayMs: 0,
    ...over,
  };
}

describe('GameOverOverlay', () => {
  it('win: glyph, title, summary line, Share and New game', () => {
    renderWithI18n(<GameOverOverlay {...props()} />);
    const dialog = screen.getByRole('dialog', { name: 'Checkmate!' });
    expect(within(dialog).getByText('🎉')).toHaveAttribute('aria-hidden', 'true');
    expect(dialog).toHaveAccessibleDescription('K7QW2M • Level 5 • 34 moves • 12:08');
    expect(within(dialog).getByRole('button', { name: 'Share' })).toHaveClass('btn-ghost');
    expect(within(dialog).getByRole('button', { name: 'New game' })).toHaveClass('btn-primary');
  });

  it('loss: no glyph', () => {
    renderWithI18n(<GameOverOverlay {...props({ myColor: 'b', end: { result: '1-0', by: 'time' } })} />);
    const dialog = screen.getByRole('dialog', { name: 'Out of time' });
    expect(within(dialog).queryByText('🎉')).toBeNull();
  });

  it('win by resignation names the reason', () => {
    renderWithI18n(<GameOverOverlay {...props({ end: { result: '1-0', by: 'resign' } })} />);
    expect(screen.getByRole('dialog', { name: 'You won!' })).toHaveTextContent('Your opponent resigned');
  });

  it('draw: title plus reason', () => {
    renderWithI18n(<GameOverOverlay {...props({ end: { result: '1/2-1/2', by: 'repetition' } })} />);
    expect(screen.getByRole('dialog', { name: 'Draw' })).toHaveTextContent('Threefold repetition');
  });

  it('pass-and-play: color wins with glyph, 2 players in the summary', () => {
    renderWithI18n(<GameOverOverlay {...props({ mode: 'local', level: undefined, end: { result: '0-1', by: 'mate' }, plies: 2 })} />);
    const dialog = screen.getByRole('dialog', { name: 'Black wins!' });
    expect(within(dialog).getByText('🎉')).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('K7QW2M • 2 players • 1 move • 12:08');
  });

  it('room: the primary action is Rematch and can wait for the opponent', () => {
    const { rerender } = renderWithI18n(<GameOverOverlay {...props({ mode: 'room' })} />);
    expect(screen.getByRole('button', { name: 'Rematch' })).toBeEnabled();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/• Room •/);
    rerender(<GameOverOverlay {...props({ mode: 'room', primaryBusy: true })} />);
    expect(screen.getByRole('button', { name: 'Rematch' })).toBeDisabled();
  });

  it('actions call back; the scrim and Escape dismiss, the content does not', () => {
    const p = props();
    renderWithI18n(<GameOverOverlay {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(p.onShare).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(p.onPrimary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('heading', { name: 'Checkmate!' }));
    expect(p.onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(p.onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'New game' }), { key: 'Escape' });
    expect(p.onDismiss).toHaveBeenCalledTimes(2);
  });

  it('focuses the primary action and traps Tab', () => {
    renderWithI18n(<GameOverOverlay {...props()} />);
    const primary = screen.getByRole('button', { name: 'New game' });
    const share = screen.getByRole('button', { name: 'Share' });
    expect(primary).toHaveFocus();
    fireEvent.keyDown(primary, { key: 'Tab' });
    expect(share).toHaveFocus();
    fireEvent.keyDown(share, { key: 'Tab', shiftKey: true });
    expect(primary).toHaveFocus();
  });

  it('with onCopyPgn, Share opens the link / PGN menu', async () => {
    const p = props({ onCopyPgn: vi.fn() });
    renderWithI18n(<GameOverOverlay {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Copy PGN' }));
    expect(p.onCopyPgn).toHaveBeenCalledTimes(1);
    expect(p.onDismiss).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderWithI18n(<GameOverOverlay {...props({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('timing', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('appears after the 1000 ms page tint by default', () => {
      const { delayMs: _ignored, ...rest } = props();
      renderWithI18n(<GameOverOverlay {...rest} />);
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => void vi.advanceTimersByTime(999));
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closing before the delay cancels it', () => {
      const { delayMs: _ignored, ...rest } = props();
      const { rerender } = renderWithI18n(<GameOverOverlay {...rest} />);
      act(() => void vi.advanceTimersByTime(500));
      rerender(<GameOverOverlay {...rest} open={false} />);
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('PageTint', () => {
  it('tints success, destructive or nothing', () => {
    const { container, rerender } = renderWithI18n(<PageTint tint="success" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('page-tint', 'completion-success', 'pointer-events-none');
    rerender(<PageTint tint="destructive" />);
    expect(container.firstChild).toHaveClass('completion-failure');
    rerender(<PageTint tint={null} />);
    expect(container.firstChild).not.toHaveClass('completion-success');
    expect(container.firstChild).not.toHaveClass('completion-failure');
  });
});
