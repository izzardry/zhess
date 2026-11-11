/**
 * Version stamp (Ztyle 10, 12; as in Zudoku): `YYYY-MM-DD HH:MM:SS (abc1234)`, bottom center on
 * phones and bottom right from 640 px. Tapping copies the string and calls `onTap` (the
 * integrator passes the service worker's update check). Start screen only.
 */
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { copyText } from './text';

/** The build's version string, from the Vite defines. */
export const APP_VERSION = `${__GIT_DATE__} (${__GIT_HASH__})`;

export interface VersionStampProps {
  visible: boolean;
  /** Called after copying, e.g. `checkForUpdate` from `useSWUpdate`. */
  onTap?: () => void;
  /** Defaults to the build's `APP_VERSION`. */
  version?: string;
  className?: string;
}

export function VersionStamp({ visible, onTap, version = APP_VERSION, className }: VersionStampProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(version);
        onTap?.();
      }}
      aria-label={t('start.versionAria', { version })}
      aria-hidden={!visible || undefined}
      tabIndex={visible ? undefined : -1}
      data-testid="version-stamp"
      className={cn(
        'fixed z-50 select-none font-mono text-[9px] text-muted-foreground/30 sm:text-[10px]',
        'bottom-[max(0.25rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2',
        'sm:left-auto sm:right-[max(0.25rem,env(safe-area-inset-right))] sm:translate-x-0',
        'cursor-pointer transition-opacity duration-500 active:text-muted-foreground/60',
        visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        className,
      )}
    >
      {version}
    </button>
  );
}
