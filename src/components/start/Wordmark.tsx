/**
 * Wordmark and headers of the start screen (DESIGN 2, 4; Ztyle 01, 10 "Sticky header").
 *
 * - `StartHeader`: fixed top block with the wordmark, the tagline and a slot for the code
 *   selector. Fades up and away while `visible` is false (game, or scrolled past 50 px).
 * - `StickyHeader`: the small wordmark bar that slides in from the top once scrolled.
 */
import { useRef, type ReactNode } from 'react';
import { BRAND } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useInert } from './useInert';

export interface WordmarkProps {
  /** `hero` 30/36 px (24 px in landscape), `header` 20 px. */
  size?: 'hero' | 'header';
  landscape?: boolean;
  /** Render as the page's `<h1>` (default) or as a plain `<div>`. */
  as?: 'h1' | 'div';
  className?: string;
}

/** `ZHESS` in light weight with 0.3em tracking; typed in caps, never translated. */
export function Wordmark({ size = 'hero', landscape = false, as: Tag = 'h1', className }: WordmarkProps) {
  return (
    <Tag
      className={cn(
        'font-mono font-light tracking-[0.3em]',
        size === 'header' ? 'text-xl' : landscape ? 'text-2xl' : 'text-3xl sm:text-4xl',
        className,
      )}
    >
      {BRAND.wordmark}
    </Tag>
  );
}

export interface StartHeaderProps {
  /** Shown on the idle start screen; hidden in game and once scrolled. */
  visible: boolean;
  landscape?: boolean;
  /** Placed under the tagline: the `CodeSelector`. */
  children?: ReactNode;
  className?: string;
}

export function StartHeader({ visible, landscape = false, children, className }: StartHeaderProps) {
  const ref = useRef<HTMLElement>(null);
  useInert(ref, !visible);
  return (
    <header
      ref={ref}
      data-testid="start-header"
      data-visible={visible}
      className={cn(
        'pointer-events-none fixed inset-x-0 z-20 flex flex-col items-center px-4',
        'top-[max(1rem,env(safe-area-inset-top))] transition-all duration-500 ease-out',
        visible ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0',
        className,
      )}
    >
      <Wordmark landscape={landscape} className="px-4 py-2" />
      <p className={cn('text-muted-foreground', landscape ? 'text-xs' : 'mt-2 text-sm')}>{BRAND.tagline}</p>
      {children && (
        <div className={cn(landscape ? 'mt-2' : 'mt-4', visible && 'pointer-events-auto')}>{children}</div>
      )}
    </header>
  );
}

export interface StickyHeaderProps {
  /** True once the start screen is scrolled past 50 px. */
  visible: boolean;
  className?: string;
}

/** Duplicate of the wordmark for sighted users only, so it is hidden from assistive tech. */
export function StickyHeader({ visible, className }: StickyHeaderProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="sticky-header"
      data-visible={visible}
      className={cn(
        'fixed inset-x-0 top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm',
        'pt-[env(safe-area-inset-top)] transition-all duration-300 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
        className,
      )}
    >
      <div className="flex items-center justify-center py-3">
        <Wordmark as="div" size="header" />
      </div>
    </div>
  );
}
