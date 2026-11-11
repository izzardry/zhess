/**
 * Translated display text of the start-screen values, shared by the selectors and usable by the
 * integrator (e.g. for toasts or the info pill). Kept apart from the components for fast refresh.
 */
import { levelKey, useI18n } from '@/lib/i18n';
import type { ColorChoice, Opponent, TimeControl } from '@/lib/types';
import { formatTc } from '@/lib/zhess';

/** Overline (`kind`) and value (`name`) of an opponent, e.g. `Computer · Level 5` / `Medium`. */
export function useOpponentText(value: Opponent): { kind: string; name: string } {
  const { t } = useI18n();
  if (value.mode === 'room') return { kind: t('start.kind.room'), name: t('start.value.room') };
  if (value.mode === 'local') return { kind: t('start.kind.local'), name: t('start.value.local') };
  return { kind: t('start.kind.computer', { level: value.level }), name: t(levelKey(value.level)) };
}

/** `Random`, `White` or `Black`, translated. */
export function useColorName(value: ColorChoice): string {
  const { t } = useI18n();
  return value === 'random' ? t('start.colorRandom') : value === 'w' ? t('white') : t('black');
}

/** `5+0`, or the translated `Off`. */
export function useClockText(value: TimeControl): string {
  const { t } = useI18n();
  return value ? (formatTc(value) ?? '') : t('start.clockOff');
}

/** Copies text to the clipboard; false when the Clipboard API is missing or refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
