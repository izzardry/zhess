import type { Config } from "tailwindcss";
import ztyle from "./src/ztyle/tailwind.preset";

// All tokens, fonts, motion and z-index come from the Ztyle preset (src/ztyle/).
// `darkMode` is restated because the preset's `["class"]` is inferred as string[], which
// Tailwind's Config type rejects; the copied preset stays verbatim. Same meaning.
export default {
  presets: [{ ...ztyle, darkMode: "class" }],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
} satisfies Config;
