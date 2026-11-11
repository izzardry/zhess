import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { Toaster, toast } from './sonner';
import { TOAST_BOTTOM_PORTRAIT, TOAST_WIDTH_LANDSCAPE, toasterPlacement } from './toasterPlacement';

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

function renderToaster(language: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider language={language}>
      <Toaster />
    </I18nProvider>,
  );
}

describe('Toaster', () => {
  it('labels the notification region in the app language (DESIGN 14)', async () => {
    renderToaster('de');
    act(() => {
      toast('Hallo');
    });
    await screen.findByText('Hallo');
    const region = document.querySelector('section[aria-label]');
    expect(region?.getAttribute('aria-label')).toMatch(/^Benachrichtigungen\b/);
  });

  it('sits above the portrait toolbar and the bottom safe area, on phones and wide screens', async () => {
    renderToaster();
    act(() => {
      toast('Link copied to clipboard!');
    });
    await screen.findByText('Link copied to clipboard!');
    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement;
    expect(toaster.style.getPropertyValue('--mobile-offset-bottom')).toBe(TOAST_BOTTOM_PORTRAIT);
    expect(toaster.style.getPropertyValue('--offset-bottom')).toBe(TOAST_BOTTOM_PORTRAIT);
    expect(TOAST_BOTTOM_PORTRAIT).toContain('env(safe-area-inset-bottom)');
    // The toolbar: 44 px buttons, py-1.5 and a border = 58 px above its own inset.
    expect(TOAST_BOTTOM_PORTRAIT).toContain('58px');
  });

  it('starts system toasts at the icon, not space-between (Ztyle .toast recipe)', async () => {
    renderToaster();
    act(() => {
      toast.success('Done');
    });
    await screen.findByText('Done');
    const frame = document.querySelector('[data-sonner-toast]') as HTMLElement;
    expect(frame).toHaveClass('toast');
    expect(frame).toHaveClass('justify-start');
  });

  it('in mobile landscape takes the bottom right beside the board', () => {
    const p = toasterPlacement(true);
    expect(p.className).toBe('zhess-toaster-rail');
    expect((p.style as Record<string, string>)['--width']).toBe(TOAST_WIDTH_LANDSCAPE);
    expect(p.offset).toMatchObject({ right: 'max(1rem, env(safe-area-inset-right))' });
    expect(p.mobileOffset).toEqual(p.offset);
    expect(String((p.offset as { bottom: string }).bottom)).toContain('env(safe-area-inset-bottom)');
  });
});
