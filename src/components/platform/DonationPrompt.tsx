/**
 * The once-only donation ask (Ztyle 13): a centered card, a coffee icon in a round amber disc
 * (the only amber in the app), the personal text trailing off into the Buy Me a Coffee button,
 * and a lowercase whisper link to dismiss. Pair with `useDonationPrompt`.
 *
 * Ported from Zudoku `DonationPrompt.tsx`; the dialog primitive carries audit fix #8 (blurred
 * scrim, rounded card with margin on mobile), the button is drawn locally (see SupportButton).
 */
import { Coffee } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { SupportButton } from './SupportButton';

export interface DonationPromptProps {
  open: boolean;
  onDismiss: () => void;
}

export function DonationPrompt({ open, onDismiss }: DonationPromptProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDismiss()}>
      <DialogContent className="sm:max-w-md text-center" closeLabel={t('close')}>
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Coffee className="w-6 h-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl font-medium">{t('platform.donation.title')}</DialogTitle>
          <DialogDescription className="text-base pt-2">{t('platform.donation.body')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 pt-2">
          <SupportButton size="md" onClick={onDismiss} />
          <button
            type="button"
            onClick={onDismiss}
            className="text-sm lowercase text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            {t('platform.donation.later')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
