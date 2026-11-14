import { describe, expect, it, vi } from 'vitest';
import { BOOT_CLASS, BOOT_FONTS, prepareFirstPaint } from './boot';

function setup(fontsResolve: boolean | 'never' = true) {
  const root = document.createElement('html');
  root.classList.add(BOOT_CLASS);
  const loads: string[] = [];
  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));
  const fonts = {
    load: vi.fn((f: string) => {
      loads.push(f);
      return fontsResolve === 'never' ? new Promise<FontFace[]>(() => {}) : Promise.resolve([] as FontFace[]);
    }),
    get ready() {
      return ready as unknown as Promise<FontFaceSet>;
    },
  };
  const timers: { cb: () => void; ms: number }[] = [];
  const deps = {
    root,
    fonts,
    raf: (cb: () => void) => void queueMicrotask(cb),
    setTimer: (cb: () => void, ms: number) => timers.push({ cb, ms }),
  };
  return { root, loads, resolveReady, timers, deps };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('first paint', () => {
  it('starts the start-screen font loads at once and reveals only after the fonts are ready', async () => {
    const { root, loads, resolveReady, deps } = setup();
    const reveal = prepareFirstPaint(1000, deps);
    expect(loads).toEqual([...BOOT_FONTS]);
    reveal();
    await flush();
    expect(root.classList.contains(BOOT_CLASS)).toBe(true);
    resolveReady();
    await flush();
    expect(root.classList.contains(BOOT_CLASS)).toBe(false);
  });

  it('a font that never arrives does not keep the app hidden: the timer reveals it', async () => {
    const { root, timers, deps } = setup('never');
    prepareFirstPaint(1000, deps)();
    await flush();
    expect(root.classList.contains(BOOT_CLASS)).toBe(true);
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    timers[0].cb();
    expect(root.classList.contains(BOOT_CLASS)).toBe(false);
  });

  it('without a font API it reveals after the first frames', async () => {
    const { root, deps } = setup();
    prepareFirstPaint(1000, { ...deps, fonts: null })();
    await flush();
    expect(root.classList.contains(BOOT_CLASS)).toBe(false);
  });

  it('does nothing when index.html did not mark the document as booting', () => {
    const { root, timers, deps } = setup();
    root.classList.remove(BOOT_CLASS);
    prepareFirstPaint(1000, deps)();
    expect(timers).toEqual([]);
  });
});
