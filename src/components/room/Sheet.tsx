/**
 * Bottom sheet of the room UI (Ztyle 10 "Bottom-sheet prompt"): a card at the bottom center over
 * a blurred scrim (DESIGN 4: the manual-connect sheet is an overlay). Radix Dialog gives the focus
 * trap, Escape and the scrim tap to close.
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** 48 px icon tile left of the title. */
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Hook for tests and the integrator. */
  testId?: string;
}

export function Sheet({ open, onOpenChange, title, description, icon, children, className, testId }: SheetProps) {
  const { t } = useI18n();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-overlay scrim animate-fade-in" />
        <DialogPrimitive.Content
          data-testid={testId}
          className={cn(
            'fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-overlay mx-auto w-auto max-w-sm',
            'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain',
            'bg-card text-card-foreground border border-border rounded-2xl shadow-xl p-4 animate-slide-up focus:outline-none',
            className,
          )}
        >
          <div className="flex items-start gap-3">
            {icon && (
              <div aria-hidden="true" className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary [&_svg]:w-6 [&_svg]:h-6">
                {icon}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <DialogPrimitive.Title className="font-mono font-medium tracking-wide text-sm">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-xs text-muted-foreground mt-1">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="icon-button -mt-1 -mr-1" aria-label={t('close')}>
              <X className="!w-4 !h-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Small uppercase label over a block of the sheet (`Step 1 of 2`). */
export function SheetLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[10px] leading-4 uppercase tracking-wider text-muted-foreground', className)}>{children}</div>;
}
