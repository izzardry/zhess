/**
 * The Buy Me a Coffee button (Ztyle 13): in the donation dialog (50 px tall) and at the very
 * bottom of the start screen's scroll area (60 px).
 *
 * Zudoku loads the official button image from cdn.buymeacoffee.com. Zhess draws the same
 * yellow button locally instead, because the app must not touch outside services except npm,
 * the PeerJS broker and STUN (PLAN 1, rule 9). The link itself is only followed on a tap.
 */
import { Coffee } from 'lucide-react';
import { cn } from '@/lib/utils';

export const SUPPORT_URL = 'https://www.buymeacoffee.com/holzschneider';

export interface SupportButtonProps {
  /** `md` = 50 px (dialog), `lg` = 60 px (start screen). */
  size?: 'md' | 'lg';
  onClick?: () => void;
  className?: string;
}

export function SupportButton({ size = 'lg', onClick, className }: SupportButtonProps) {
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-2.5 rounded-lg bg-[#FFDD00] text-black',
        'border border-black/10 shadow-sm hover:opacity-90 active:scale-95 transition-all duration-200',
        size === 'lg' ? 'h-[60px] w-[217px] text-base' : 'h-[50px] px-5 text-sm',
        className,
      )}
    >
      <Coffee className={size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'} aria-hidden="true" />
      <span className="font-medium tracking-tight">Buy me a coffee</span>
    </a>
  );
}
