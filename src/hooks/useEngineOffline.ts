/**
 * Keeps an offline copy of the engine and reports its state for the start screen (DESIGN 14).
 *
 * On launch: checks `engine-cache`; if the engine is missing and the device is online, downloads
 * it after a short delay (so it does not compete with the first paint). Offline, it waits for the
 * `online` event. With Save-Data on, it waits for a tap (`download`). A failed download also
 * waits for a tap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadEngine, isEngineCached, type EngineOfflineDeps, type EngineOfflineStatus } from '@/lib/engine/offline';

export const ENGINE_DOWNLOAD_DELAY_MS = 1000;

export interface UseEngineOfflineOptions extends EngineOfflineDeps {
  /** Base URL the engine files resolve against; `document.baseURI` by default. */
  base?: string;
  /** Delay before the automatic download. */
  delayMs?: number;
  /** Overrides for tests. */
  online?: () => boolean;
  saveData?: () => boolean;
  supported?: boolean;
}

interface NetworkInformationLike {
  saveData?: boolean;
}

const defaultOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
const defaultSaveData = () =>
  typeof navigator !== 'undefined' && !!(navigator as Navigator & { connection?: NetworkInformationLike }).connection?.saveData;
const defaultSupported = () =>
  typeof window !== 'undefined' && 'caches' in window && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export function useEngineOffline(options: UseEngineOfflineOptions = {}): {
  state: EngineOfflineStatus;
  download: () => void;
} {
  const optsRef = useRef(options);
  optsRef.current = options;
  const supported = options.supported ?? defaultSupported();
  const [state, setState] = useState<EngineOfflineStatus>(supported ? { status: 'checking' } : { status: 'unsupported' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const running = useRef<AbortController | null>(null);
  const alive = useRef(true);

  const download = useCallback(() => {
    if (running.current) return;
    const o = optsRef.current;
    const online = o.online ?? defaultOnline;
    if (!online()) {
      setState({ status: 'missing', reason: 'offline' });
      return;
    }
    const ctrl = new AbortController();
    running.current = ctrl;
    setState({ status: 'downloading', percent: 0 });
    const base = o.base ?? document.baseURI;
    downloadEngine(base, (percent) => alive.current && setState({ status: 'downloading', percent }), ctrl.signal, o)
      .then(() => alive.current && setState({ status: 'ready' }))
      .catch(() => alive.current && !ctrl.signal.aborted && setState({ status: 'missing', reason: online() ? 'failed' : 'offline' }))
      .finally(() => {
        if (running.current === ctrl) running.current = null;
      });
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!supported) return;
    const o = optsRef.current;
    const online = o.online ?? defaultOnline;
    const saveData = o.saveData ?? defaultSaveData;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Back online after the launch check or a download found the device offline.
    const onOnline = () => {
      const s = stateRef.current;
      if (s.status === 'missing' && s.reason === 'offline' && !saveData()) download();
    };
    window.addEventListener('online', onOnline);

    isEngineCached(o.base ?? document.baseURI, o)
      .then((cached) => {
        if (!alive.current) return;
        if (cached) return setState({ status: 'ready' });
        if (!online()) return setState({ status: 'missing', reason: 'offline' });
        if (saveData()) return setState({ status: 'missing', reason: 'saveData' });
        timer = setTimeout(download, o.delayMs ?? ENGINE_DOWNLOAD_DELAY_MS);
      })
      .catch(() => alive.current && setState({ status: 'unsupported' }));

    return () => {
      alive.current = false;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      running.current?.abort();
      running.current = null;
    };
  }, [supported, download]);

  return { state, download };
}
