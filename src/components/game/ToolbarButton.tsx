import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useLongPress } from '@/hooks/useLongPress';
import { cn } from '@/lib/utils';

export interface ToolbarButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Translated aria-label; names the action, including any hold (Ztyle 16). */
  label: string;
  icon: ReactNode;
  /** Short press. */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Optional long press on this button. */
  hold?: { ms: number; onHold: () => void; onHoldEnd?: () => void };
}

/**
 * A toolbar icon button: `.icon-button`, sized by the bar's `--tb` variable (always 44 px, the
 * least touch target of DESIGN 14.1), with an optional long press that suppresses its trailing click.
 */
export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(function ToolbarButton(
  { label, icon, onClick, hold, className, disabled, ...rest },
  ref,
) {
  const press = useLongPress({
    ms: hold?.ms ?? 0,
    onLongPress: () => hold?.onHold(),
    onLongPressEnd: () => hold?.onHoldEnd?.(),
    onClick: (e) => onClick?.(e as React.MouseEvent<HTMLButtonElement>),
    disabled: !hold || disabled,
  });

  const holdHandlers = hold
    ? {
        onPointerDown: press.onPointerDown,
        onPointerUp: press.onPointerUp,
        onPointerLeave: press.onPointerLeave,
        onPointerCancel: press.onPointerCancel,
        onKeyDown: press.onKeyDown,
        onKeyUp: press.onKeyUp,
        onContextMenu: press.onContextMenu,
      }
    : {};

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'icon-button p-0 shrink-0 select-none touch-manipulation [-webkit-touch-callout:none]',
        'w-[var(--tb,44px)] h-[var(--tb,44px)]',
        className,
      )}
      {...rest}
      {...holdHandlers}
      onClick={press.onClick}
    >
      {icon}
    </button>
  );
});
