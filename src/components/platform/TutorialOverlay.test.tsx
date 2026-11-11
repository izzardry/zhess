import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialOverlay, TUTORIAL_EXIT_MS } from './TutorialOverlay';
import { renderWithI18n } from './test-utils';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TutorialOverlay', () => {
  it('covers DESIGN 14.2: move, underpromotion, shield, bulb, flag, hide UI', () => {
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch isLandscape={false} />);
    const dialog = screen.getByRole('dialog', { name: 'How to play' });
    expect(dialog).toHaveTextContent('Back to start');
    expect(dialog).toHaveTextContent('Your game is saved');
    expect(dialog).toHaveTextContent('Game code');
    expect(dialog).toHaveTextContent('Tap a piece, then a square. Or drag it.');
    expect(dialog).toHaveTextContent('Hold the last square to pick a piece');
    expect(dialog).toHaveTextContent('Helpers on or off');
    expect(dialog).toHaveTextContent('Tap: hint · Hold: threats');
    expect(dialog).toHaveTextContent('Tap: draw · Hold: resign');
    expect(dialog).toHaveTextContent('Tap background to hide UI');
    expect(dialog).toHaveTextContent('Tap anywhere to start');
  });

  it('is portaled to the body above everything', () => {
    const { container } = renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByTestId('tutorial-overlay').parentElement).toBe(document.body);
    expect(screen.getByTestId('tutorial-overlay').className).toContain('z-[100]');
  });

  it('teaches typing moves on pointer devices', () => {
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch={false} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Click or drag a piece. Or type a move:');
    expect(screen.getByText('Nf3')).toBeInTheDocument();
  });

  it('follows the mode: no bulb in rooms, resign only in pass-and-play', () => {
    const { unmount } = renderWithI18n(<TutorialOverlay onDismiss={() => {}} mode="room" isTouch />);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Tap: hint');
    unmount();
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} mode="local" isTouch />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Hold: resign');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Tap: draw');
  });

  it('has a landscape arrangement with the same content', () => {
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isLandscape isTouch />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Helpers on or off');
    expect(screen.getByRole('dialog')).toHaveTextContent('Back to start');
  });

  it('dismisses once on a tap anywhere, after the fade-out', () => {
    const onDismiss = vi.fn();
    renderWithI18n(<TutorialOverlay onDismiss={onDismiss} isTouch />);
    const overlay = screen.getByTestId('tutorial-overlay');
    fireEvent.click(screen.getByText('Helpers on or off'));
    fireEvent.click(overlay);
    expect(overlay.className).toContain('opacity-0');
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TUTORIAL_EXIT_MS));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses with a key and takes focus', () => {
    const onDismiss = vi.fn();
    renderWithI18n(<TutorialOverlay onDismiss={onDismiss} isTouch />);
    expect(screen.getByTestId('tutorial-overlay')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(TUTORIAL_EXIT_MS));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is translated', () => {
    renderWithI18n(<TutorialOverlay onDismiss={() => {}} isTouch />, 'fr');
    expect(screen.getByRole('dialog', { name: 'Comment jouer' })).toHaveTextContent('Aides activées ou non');
  });
});
