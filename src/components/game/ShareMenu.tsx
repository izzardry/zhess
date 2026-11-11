import { useState, type ReactElement } from 'react';
import { Copy, Link } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useI18n } from '@/lib/i18n';

export interface ShareMenuProps {
  /** The button that opens the menu (must forward its ref and props, like `ToolbarButton`). */
  trigger: ReactElement;
  onShareLink: () => void;
  onCopyPgn: () => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/**
 * Share for a finished game (DESIGN 12.3, 13.2): a small popover offering the link and `Copy PGN`.
 * Rows follow Ztyle 10 (popover menus: `px-3 py-2 rounded-md text-sm hover:bg-accent`).
 */
export function ShareMenu({ trigger, onShareLink, onCopyPgn, side = 'top', align = 'center' }: ShareMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={8} className="w-auto min-w-[180px] p-1 rounded-xl font-mono">
        <div role="menu" aria-label={t('game.shareMenu')} className="flex flex-col">
          <button
            type="button"
            role="menuitem"
            onClick={pick(onShareLink)}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left hover:bg-accent focus-visible:bg-accent outline-none"
          >
            <Link className="w-4 h-4" aria-hidden="true" />
            {t('game.shareLink')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pick(onCopyPgn)}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left hover:bg-accent focus-visible:bg-accent outline-none"
          >
            <Copy className="w-4 h-4" aria-hidden="true" />
            {t('game.copyPgn')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
