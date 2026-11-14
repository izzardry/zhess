/**
 * First paint without flicker (DESIGN 14). `index.html` marks the document `zhess-booting`, which
 * keeps `#root` transparent, and sets the theme class before anything loads. This module asks for
 * the brand font's start-screen weights at once, lets React render and lay out the first screen
 * while it is still invisible (the preview fit runs in a layout effect), and then removes the class,
 * so the page fades in over 300 ms with its fonts, positions and scale already final.
 *
 * The reveal waits at most `maxMs`: a font that does not arrive must not keep the app hidden.
 */

/** The weights the start screen uses: wordmark 300, text 400, level name and code 500. */
export const BOOT_FONTS = ['300 1em "Fira Code"', '400 1em "Fira Code"', '500 1em "Fira Code"'] as const;
export const BOOT_CLASS = 'zhess-booting';
export const BOOT_MAX_MS = 1000;

export interface BootDeps {
  root?: HTMLElement;
  fonts?: Pick<FontFaceSet, 'load' | 'ready'> | null;
  raf?: (cb: () => void) => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
}

/** Starts the font loads now; returns `reveal()`, to call once the first render is committed. */
export function prepareFirstPaint(maxMs = BOOT_MAX_MS, deps: BootDeps = {}): () => void {
  const root = deps.root ?? document.documentElement;
  const fonts = deps.fonts !== undefined ? deps.fonts : typeof document !== 'undefined' ? document.fonts ?? null : null;
  const raf = deps.raf ?? ((cb: () => void) => void requestAnimationFrame(cb));
  const setTimer = deps.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));

  const fontsReady: Promise<unknown> = fonts
    ? Promise.all(BOOT_FONTS.map((f) => fonts.load(f).catch(() => []))).then(() => fonts.ready)
    : Promise.resolve();

  let done = false;
  const show = () => {
    if (done) return;
    done = true;
    root.classList.remove(BOOT_CLASS);
  };

  return () => {
    if (!root.classList.contains(BOOT_CLASS)) return;
    setTimer(show, maxMs);
    // Two frames after the fonts: React has committed, layout effects have measured, and the
    // browser has laid the page out once with the final font.
    fontsReady.then(
      () => raf(() => raf(show)),
      () => raf(() => raf(show)),
    );
  };
}
