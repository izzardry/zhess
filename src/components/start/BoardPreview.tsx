/**
 * The stage's board slot (DESIGN 4, Ztyle 05 "The stage"). The board is always rendered in the
 * same place; on the start screen it is blurred (8 px, 60 % opacity) and the Start pill floats
 * over its exact center. Switching `blurred` animates the blur in or out (500 ms) only when
 * `animate` is set, so the first paint and reloads do not animate.
 *
 * Uses Ztyle's `.board--preview` / `.board--transition` recipes, which also drop the blur under
 * `prefers-reduced-motion`.
 *
 * While blurred, the board is drawn smaller and shifted so it fits between the start header and
 * footer (`previewFit.ts`; the elements marked `data-start-edge="top"` / `"bottom"`). The Start pill
 * follows the shift and keeps its size.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { NO_FIT, previewFit, type PreviewFit } from './previewFit';
import { useInert } from './useInert';

/** Measures the chrome around the board and returns the fit; NO_FIT when not blurred. */
function usePreviewFit(outer: React.RefObject<HTMLElement>, blurred: boolean): PreviewFit {
  const [fit, setFit] = useState<PreviewFit>(NO_FIT);
  useLayoutEffect(() => {
    if (!blurred) {
      setFit(NO_FIT);
      return;
    }
    const measure = () => {
      const el = outer.current;
      const header = document.querySelector<HTMLElement>('[data-start-edge="top"]');
      const footer = document.querySelector<HTMLElement>('[data-start-edge="bottom"]');
      if (!el || !header || !footer) return setFit(NO_FIT);
      // Header and footer are fixed: offsetTop is their layout position in the viewport (their
      // show/hide translate does not count). The board is measured untransformed (outer box).
      const rect = el.getBoundingClientRect();
      const next = previewFit({
        boardTop: rect.top + window.scrollY,
        boardHeight: rect.height,
        top: header.offsetTop + header.offsetHeight,
        bottom: footer.offsetTop,
      });
      setFit((prev) => (Math.abs(prev.scale - next.scale) < 0.001 && Math.abs(prev.dy - next.dy) < 0.5 ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    for (const sel of ['[data-start-edge="top"]', '[data-start-edge="bottom"]']) {
      const node = document.querySelector(sel);
      if (node) ro?.observe(node);
    }
    if (outer.current) ro?.observe(outer.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [outer, blurred]);
  return fit;
}

/** Filter and opacity (Ztyle's board transition) plus the preview's scale and shift. */
const TRANSITION = ['filter', 'opacity', 'scale', 'translate'].map((p) => `${p} var(--dur-screen) var(--ease)`).join(', ');

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
  const outerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fit = usePreviewFit(outerRef, blurred);
  const fitted = fit.scale !== 1 || fit.dy !== 0;
  const boardStyle: CSSProperties = {
    transition: TRANSITION,
    ...(fitted ? { scale: String(fit.scale), translate: `0 ${fit.dy}px` } : null),
  };
  // The blurred preview is decoration: keep its squares out of the tab order and the a11y tree.
  useInert(boardRef, blurred);
  useInert(overlayRef, !overlayVisible);

  return (
    <div ref={outerRef} className={cn('relative flex items-center justify-center', className)} data-testid="board-preview">
      <div
        ref={boardRef}
        data-blurred={blurred}
        data-fit={fitted ? fit.scale.toFixed(3) : undefined}
        style={boardStyle}
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
          style={fit.dy !== 0 ? { translate: `0 ${fit.dy}px` } : undefined}
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
