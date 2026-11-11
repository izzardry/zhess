import { ArrowUpDown, Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Seating } from '@/lib/types';
import { ToolbarButton } from './ToolbarButton';

export interface SeatingButtonProps {
  /** Current seating; the icon shows it, the label says what pressing does (Ztyle 16). */
  seating: Seating;
  onToggle: () => void;
  className?: string;
}

/** Pass-and-play seating switch (DESIGN 5.2): face to face (↕) or side by side (two people). */
export function SeatingButton({ seating, onToggle, className }: SeatingButtonProps) {
  const { t } = useI18n();
  const face = seating === 'face';
  return (
    <ToolbarButton
      label={face ? t('game.seatSideBySide') : t('game.seatFaceToFace')}
      icon={face ? <ArrowUpDown aria-hidden="true" /> : <Users aria-hidden="true" />}
      onClick={onToggle}
      data-slot="seating"
      data-seating={seating}
      className={className}
    />
  );
}
