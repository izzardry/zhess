/**
 * Language switcher (Ztyle 10): a `.fab` with the current flag; the dropdown lists
 * `flag + native name`, the current one bold. Start screen only.
 * Ported from Zudoku `LanguageSwitcher.tsx` with audit fix #15 (translated aria-label).
 */
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LANGUAGES, useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { language, setLanguage, t } = useI18n();
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn('fab text-lg leading-none select-none', className)}
          aria-label={`${t('changeLanguage')}: ${current.label}`}
        >
          <span aria-hidden="true">{current.flag}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            lang={lang.code}
            onSelect={() => setLanguage(lang.code)}
            className={cn('flex items-center gap-2 cursor-pointer', lang.code === language && 'font-bold')}
            aria-current={lang.code === language ? 'true' : undefined}
          >
            <span className="text-base" aria-hidden="true">
              {lang.flag}
            </span>
            <span className="text-sm">{lang.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
