// Copied verbatim from Ztyle (~/Workspace/ztyle/tokens/tailwind.preset.ts, github.com/izzardry/ztyle, rev d29758b).
// Do not edit here: change Ztyle and copy again.
/**
 * Ztyle — Tailwind CSS 3 preset for izzardry games.
 *
 *   // tailwind.config.ts
 *   import ztyle from "./ztyle/tokens/tailwind.preset";
 *   export default { presets: [ztyle], content: ["./index.html", "./src/**\/*.{ts,tsx}"] };
 *
 * Load tokens/ztyle.css once (it defines the CSS variables this preset reads,
 * plus the base layer and component classes).
 */
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const mono = ['"Fira Code"', '"JetBrains Mono"', '"SF Mono"', "ui-monospace", "Menlo", "Consolas", "monospace"];
const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

const preset = {
  darkMode: ["class"],
  theme: {
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        // Both point at the brand stack: no second mono face sneaks in via `font-mono`.
        sans: mono,
        mono,
      },
      letterSpacing: { mark: "0.3em" },
      colors: {
        border: c("border"),
        input: c("input"),
        ring: c("ring"),
        background: c("background"),
        foreground: c("foreground"),
        primary: { DEFAULT: c("primary"), foreground: c("primary-foreground") },
        secondary: { DEFAULT: c("secondary"), foreground: c("secondary-foreground") },
        destructive: { DEFAULT: c("destructive"), foreground: c("destructive-foreground") },
        success: { DEFAULT: c("success"), foreground: c("success-foreground") },
        muted: { DEFAULT: c("muted"), foreground: c("muted-foreground") },
        accent: { DEFAULT: c("accent"), foreground: c("accent-foreground") },
        popover: { DEFAULT: c("popover"), foreground: c("popover-foreground") },
        card: { DEFAULT: c("card"), foreground: c("card-foreground") },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      transitionDuration: {
        instant: "100ms",
        fast: "150ms",
        base: "200ms",
        chrome: "300ms",
        screen: "500ms",
        pulse: "800ms",
        ambient: "1000ms",
      },
      zIndex: {
        stage: "10",
        "start-ui": "20",
        sticky: "30",
        chrome: "40",
        overlay: "50",
        tutorial: "100",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.95)" }, to: { opacity: "1", transform: "scale(1)" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "error-pulse": {
          "0%, 100%": { boxShadow: "inset 0 0 0 0 hsl(var(--destructive) / 0.15)" },
          "50%": { boxShadow: "inset 0 0 6px 1px hsl(var(--destructive) / 0.3)" },
        },
        // Inset shadow instead of background-color, so the cell keeps its own fill afterwards.
        "hint-pulse": {
          "0%": { boxShadow: "0 0 0 0 hsl(var(--success) / 0.7), inset 0 0 0 999px hsl(var(--success) / 0.3)" },
          "50%": { boxShadow: "0 0 0 8px hsl(var(--success) / 0), inset 0 0 0 999px hsl(var(--success) / 0.15)" },
          "100%": { boxShadow: "0 0 0 0 hsl(var(--success) / 0), inset 0 0 0 999px hsl(var(--success) / 0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out both",
        "scale-in": "scale-in 0.2s ease-out both",
        "slide-up": "slide-up 0.3s ease-out both",
        "error-pulse": "error-pulse 2s ease-in-out -10000s infinite",
        "hint-pulse": "hint-pulse 0.8s ease-out forwards",
      },
    },
  },
  plugins: [animate],
} satisfies Omit<Config, "content">;

export default preset;
