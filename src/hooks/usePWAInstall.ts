/**
 * PWA install offer (Ztyle 12 "Install").
 *
 * Captures `beforeinstallprompt`. The bottom-sheet prompt shows once on the start screen
 * (`shouldShowPrompt`); after "Not now" only the small "Install app" pill remains (`canInstall`).
 * Everything is hidden once installed (`display-mode: standalone`, or iOS `navigator.standalone`).
 *
 * Ported from Zudoku `usePWAInstall.ts` with the storage key fix (Ztyle audit #13:
 * `zhess:install-dismissed`), and: a used prompt event is dropped whatever the outcome, so the
 * pill never stays visible with nothing behind it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { flags } from '@/lib/flags';
import { store as defaultStore } from '@/lib/storage';
import type { Store } from '@/lib/types';

export const INSTALL_DISMISSED_KEY = 'install-dismissed';

/** Chromium's `beforeinstallprompt` event (not in lib.dom). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export interface UsePWAInstallOptions {
  store?: Store;
  /** Feature flag; `flags.installPrompt` by default. */
  enabled?: boolean;
}

export interface PWAInstallState {
  /** A deferred install prompt is available. */
  isInstallable: boolean;
  /** Running as an installed app, or installed during this session. */
  isInstalled: boolean;
  /** "Not now" was chosen on this device. */
  wasDismissed: boolean;
  /** Show `<PWAInstallPrompt>` (start screen only, never in game). */
  shouldShowPrompt: boolean;
  /** Show `<InstallButton>` (also after a dismissal). */
  canInstall: boolean;
  /** Opens the browser's install dialog; resolves true when accepted. */
  install: () => Promise<boolean>;
  /** "Not now": hides the sheet for good, keeps the pill. */
  dismiss: () => void;
  resetDismissal: () => void;
}

/** True when the page runs as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* ignore */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function usePWAInstall({ store = defaultStore, enabled = flags.installPrompt }: UsePWAInstallOptions = {}): PWAInstallState {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setInstallable] = useState(false);
  const [isInstalled, setInstalled] = useState(isStandalone);
  const [wasDismissed, setDismissed] = useState(() => store.pref<boolean>(INSTALL_DISMISSED_KEY, false) === true);

  useEffect(() => {
    if (!enabled) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      if (isStandalone()) return;
      deferred.current = e as BeforeInstallPromptEvent;
      setInstallable(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setInstalled(true);
      setInstallable(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    let mql: MediaQueryList | null = null;
    const onDisplayMode = () => {
      if (isStandalone()) onInstalled();
    };
    try {
      mql = window.matchMedia?.('(display-mode: standalone)') ?? null;
      mql?.addEventListener?.('change', onDisplayMode);
    } catch {
      mql = null;
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mql?.removeEventListener?.('change', onDisplayMode);
    };
  }, [enabled]);

  const install = useCallback(async () => {
    const ev = deferred.current;
    if (!ev) return false;
    // A prompt event can be used once; drop it whatever happens.
    deferred.current = null;
    setInstallable(false);
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    store.setPref(INSTALL_DISMISSED_KEY, true);
  }, [store]);

  const resetDismissal = useCallback(() => {
    setDismissed(false);
    store.setPref(INSTALL_DISMISSED_KEY, undefined);
  }, [store]);

  const canInstall = enabled && isInstallable && !isInstalled;
  return {
    isInstallable,
    isInstalled,
    wasDismissed,
    shouldShowPrompt: canInstall && !wasDismissed,
    canInstall,
    install,
    dismiss,
    resetDismissal,
  };
}
