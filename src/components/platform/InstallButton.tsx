/**
 * The small "Install app" pill under the opponent selector (Ztyle 10 "Exception: small pill"),
 * shown while `usePWAInstall().canInstall`. Ported from Zudoku `InstallButton.tsx`.
 */
import { Download } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface InstallButtonProps {
  onClick: () => void;
  className?: string;
}

export function InstallButton({ onClick, className }: InstallButtonProps) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onClick} className={cn('pill-sm', className)}>
      <Download aria-hidden="true" />
      {t('platform.install.pill')}
    </button>
  );
}
