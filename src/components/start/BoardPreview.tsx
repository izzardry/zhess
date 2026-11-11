/**
 * The stage's board slot (DESIGN 4, Ztyle 05 "The stage"). The board is always rendered in the
 * same place; on the start screen it is blurred (8 px, 60 % opacity) and the Start pill floats
 * over its exact center. Switching `blurred` animates the blur in or out (500 ms) only when
 * `animate` is set, so the first paint and reloads do not animate.
 *
 * Uses Ztyle's `.board--preview` / `.board--transition` recipes, which also drop the blur under
 * `prefers-reduced-motion`.
 */
import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useInert } from './useInert';

export interface BoardPreviewProps {
  /** The board (or anything that should stay centered). */
  children: ReactNode;
  /** Start screen state: 8 px blur, 60 % opacity, not interactive. */
  blurred: boolean;
  /** Animate the change of `blurred` (set during start ⇄ game transitions). */
  animate?: boolean;
  /** Content centered over the board, normally the `StartPill`. */
  overlay?: ReactNode;
  /** Whether the overlay is shown (fades and scales; defaults to `blurred`). */
  overlayVisible?: boolean;
  className?: string;
}

export function BoardPreview({ children, blurred, animate = false, overlay, overlayVisible = blurred, className }: BoardPreviewProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // The blurred preview is decoration: keep its squares out of the tab order and the a11y tree.
  useInert(boardRef, blurred);
  useInert(overlayRef, !overlayVisible);

  return (
    <div className={cn('relative flex items-center justify-center', className)} data-testid="board-preview">
      <div
        ref={boardRef}
        data-blurred={blurred}
        aria-hidden={blurred || undefined}
        className={cn(
          'board--transition',
          blurred && 'board--preview pointer-events-none',
          !animate && '!transition-none',
        )}
      >
        {children}
      </div>

      {overlay !== undefined && (
        <div
          ref={overlayRef}
          data-visible={overlayVisible}
          className={cn(
            'absolute inset-0 z-10 flex flex-col items-center justify-center',
            'transition-all duration-500 ease-out',
            overlayVisible ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
          )}
        >
          {overlay}
        </div>
      )}
    </div>
  );
}
