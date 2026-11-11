import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";

// https://vitejs.dev/config/
export default defineConfig(() => {
  const gitHash = (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return "dev";
    }
  })();
  const gitDate = (() => {
    try {
      return execSync("git log -1 --format=%ci").toString().trim().slice(0, 19).replace("T", " ");
    } catch {
      return "";
    }
  })();

  return {
    // Relative paths so the build works at any path (GitHub Pages project sites).
    base: "./",
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "robots.txt"],
        manifest: {
          name: "Zhess - Zero Distractions. Just Chess.",
          short_name: "Zhess",
          description: "Zero Distractions. Just Chess.",
          theme_color: "#0d0d0d",
          background_color: "#0d0d0d",
          display: "standalone",
          orientation: "any",
          start_url: "./",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-512x512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          // The Stockfish engine (~1.9 MB) is not precached; it is fetched on first use
          // and then served from the runtime cache below (DESIGN.md section 14).
          globIgnores: ["engine/**"],
          // Network-first HTML (Ztyle 12, DESIGN 14). index.html stays in the precache so the app
          // works offline from the first load, but navigations must not be answered from it:
          // precacheAndRoute is registered before the runtime routes and would otherwise serve
          // every navigation ("./", the only one under HashRouter) cache-first through its
          // directory index. Without one, navigations reach the NetworkFirst route below, which
          // falls back to the precached shell when the network and html-cache both fail.
          directoryIndex: null,
          navigateFallback: undefined,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "html-cache",
                expiration: { maxEntries: 10 },
                networkTimeoutSeconds: 3,
                precacheFallback: { fallbackURL: "index.html" },
              },
            },
            {
              // Stockfish worker script and wasm: cache-first once fetched, so computer games work offline.
              urlPattern: ({ url }) => /\/engine\/[^/]+\.(?:js|wasm)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "engine-cache",
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    define: {
      __GIT_HASH__: JSON.stringify(gitHash),
      __GIT_DATE__: JSON.stringify(gitDate),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
