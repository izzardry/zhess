/**
 * Credit lines at the bottom of the start screen's scroll area:
 *
 * - `EngineCredit`: `computer opponent: Stockfish (GPLv3)` (DESIGN 15.2). "Stockfish" links to
 *   the upstream source of the shipped build, "GPLv3" to the licence file next to the engine.
 * - `IzzardryFooter`: `an izzardry game` (Ztyle 01), lowercase, 10 px, muted at 40 %.
 */
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Upstream of the files in public/engine (stockfish.js 19.0.1, see public/engine/README.md). */
export const ENGINE_SOURCE_URL = 'https://github.com/nmrugg/stockfish.js';
/** The GPLv3 text shipped next to the engine; relative, so it works under `base: "./"`. */
export const ENGINE_LICENCE_URL = 'engine/Copying.txt';

const link = 'text-muted-foreground/80 hover:text-foreground transition-colors';

export function EngineCredit({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p className={cn('text-[10px] text-muted-foreground/60 text-center', className)}>
      {t('platform.credits.engine')}:{' '}
      <a href={ENGINE_SOURCE_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Stockfish
      </a>{' '}
      (
      <a href={ENGINE_LICENCE_URL} target="_blank" rel="noopener noreferrer" className={link} title={t('platform.credits.licence')}>
        GPLv3
      </a>
      )
    </p>
  );
}

export function IzzardryFooter({ className }: { className?: string }) {
  const { t } = useI18n();
  return <p className={cn('text-[10px] lowercase text-muted-foreground/40 text-center', className)}>{t('platform.credits.footer')}</p>;
}
