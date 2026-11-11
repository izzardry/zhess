import "@testing-library/jest-dom/vitest";

// Node 26 defines its own global localStorage/sessionStorage getters, which hide
// jsdom's under Vitest (both read as undefined). Restore jsdom's, or fall back to
// a minimal in-memory Storage, so hooks that use web storage directly can be tested.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
const jsdomWindow = (globalThis as unknown as { jsdom?: { window: Record<string, Storage> } }).jsdom?.window;
for (const k of ["localStorage", "sessionStorage"] as const) {
  let s: Storage | undefined;
  try { s = jsdomWindow?.[k]; } catch { s = undefined; }
  if (!s) s = new MemoryStorage();
  Object.defineProperty(globalThis, k, { value: s, configurable: true, writable: true });
  if (typeof window !== "undefined" && window !== (globalThis as unknown)) {
    Object.defineProperty(window, k, { value: s, configurable: true, writable: true });
  }
}

// jsdom has no matchMedia; components and main.tsx read prefers-color-scheme and
// prefers-reduced-motion through it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
