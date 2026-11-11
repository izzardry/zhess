/**
 * Service worker updates (Ztyle 12 "Updates", 09 "Update available").
 *
 * - Checks for a new version every hour (`registration.update()`).
 * - When a new worker is waiting, shows the toast "A new version is available" with a
 *   **Reload** action for 15 s. Reload tells the worker to skip waiting; the page reloads once
 *   the new worker takes control.
 * - With `registerType: "autoUpdate"` the new worker activates by itself and only
 *   `controllerchange` fires. The page then reloads at once, unless `shouldAutoReload()` says
 *   the moment is bad (a game in progress): then the same Reload toast is shown instead.
 * - `checkForUpdate()` is the manual check behind the version stamp.
 *
 * Ported from Zudoku `useSWUpdate.tsx` (shadcn toast → sonner), with fixes: no reload when the
 * very first worker claims the page, the hourly interval and listeners are cleaned up, and the
 * check is injectable for tests.
 */
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const UPDATE_TOAST_MS = 15_000;
export const UPDATE_TOAST_ID = 'zhess-sw-update';

export type UpdateCheckResult = 'available' | 'none' | 'unsupported';

export interface UseSWUpdateOptions {
  /** The service worker container; `navigator.serviceWorker` by default. */
  container?: ServiceWorkerContainer | null;
  /** How often to ask for a new version; default one hour. */
  intervalMs?: number;
  /** Reloads the page; `location.reload` by default. */
  reload?: () => void;
  /**
   * Asked when a new worker has taken control. Return false while reloading would interrupt
   * (a game in progress): the Reload toast is shown instead. Default: always reload.
   */
  shouldAutoReload?: () => boolean;
  /** Shows the update toast; sonner by default. `onReload` is the Reload action. */
  notify?: (message: string, actionLabel: string, onReload: () => void) => void;
}

export interface SWUpdateState {
  /** Manual check (version stamp). Shows the toast when an update is waiting. */
  checkForUpdate: () => Promise<UpdateCheckResult>;
}

function defaultContainer(): ServiceWorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
}

function sonnerNotify(message: string, actionLabel: string, onReload: () => void) {
  toast(message, {
    id: UPDATE_TOAST_ID,
    duration: UPDATE_TOAST_MS,
    action: { label: actionLabel, onClick: onReload },
  });
}

export function useSWUpdate(options: UseSWUpdateOptions = {}): SWUpdateState {
  const { t } = useI18n();
  const opts = useRef(options);
  opts.current = options;
  const tRef = useRef(t);
  tRef.current = t;
  const reloading = useRef(false);

  const container = options.container === undefined ? defaultContainer() : options.container;

  const doReload = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    (opts.current.reload ?? (() => window.location.reload()))();
  }, []);

  /** Shows the toast; Reload activates `waiting` (if any) and reloads. */
  const prompt = useCallback(
    (waiting: ServiceWorker | null) => {
      const notify = opts.current.notify ?? sonnerNotify;
      notify(tRef.current('platform.update.available'), tRef.current('platform.update.reload'), () => {
        if (waiting) {
          try {
            waiting.postMessage({ type: 'SKIP_WAITING' });
          } catch {
            /* ignore */
          }
          // controllerchange reloads; if the worker never takes over, reload anyway.
          setTimeout(doReload, 3000);
        } else {
          doReload();
        }
      });
    },
    [doReload],
  );

  useEffect(() => {
    if (!container) return;
    let disposed = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let registration: ServiceWorkerRegistration | undefined;
    // The very first worker claiming an uncontrolled page is not an update.
    let hadController = !!container.controller;

    const onControllerChange = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (reloading.current) return;
      const auto = opts.current.shouldAutoReload?.() ?? true;
      if (auto) doReload();
      else prompt(null);
    };

    const watchInstalling = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (!disposed && worker.state === 'installed' && container.controller) prompt(worker);
      });
    };
    const onUpdateFound = () => watchInstalling(registration?.installing ?? null);

    container.addEventListener('controllerchange', onControllerChange);

    void (async () => {
      try {
        registration = await container.getRegistration();
        if (disposed || !registration) return;
        if (registration.waiting && container.controller) prompt(registration.waiting);
        registration.addEventListener('updatefound', onUpdateFound);
        const intervalMs = opts.current.intervalMs ?? UPDATE_CHECK_INTERVAL_MS;
        interval = setInterval(() => {
          registration?.update().catch(() => {});
        }, intervalMs);
      } catch {
        /* no service worker: nothing to do */
      }
    })();

    return () => {
      disposed = true;
      container.removeEventListener('controllerchange', onControllerChange);
      registration?.removeEventListener('updatefound', onUpdateFound);
      if (interval) clearInterval(interval);
    };
  }, [container, doReload, prompt]);

  const checkForUpdate = useCallback(async (): Promise<UpdateCheckResult> => {
    if (!container) return 'unsupported';
    try {
      const registration = await container.getRegistration();
      if (!registration) return 'unsupported';
      if (registration.waiting) {
        prompt(registration.waiting);
        return 'available';
      }
      await registration.update();
      if (registration.waiting) {
        prompt(registration.waiting);
        return 'available';
      }
      // A worker that is still installing will prompt through `updatefound` / `statechange`.
      return registration.installing ? 'available' : 'none';
    } catch {
      return 'none';
    }
  }, [container, prompt]);

  return { checkForUpdate };
}
