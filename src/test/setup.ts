import "@testing-library/jest-dom/vitest";

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
