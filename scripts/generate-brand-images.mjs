#!/usr/bin/env node
/**
 * Rasterizes the Zhess brand images into public/ (DESIGN 2, Ztyle 01 and 12):
 *
 *   public/pwa-192x192.png            icon, 192 × 192
 *   public/pwa-512x512.png            icon, 512 × 512
 *   public/pwa-512x512-maskable.png   icon, 512 × 512, motif scaled into the central 80 %
 *   public/favicon.ico                PNG-in-ICO: 16, 32, 48 (simplified) and 256 (full)
 *   public/og-image.png               social card, 1200 × 630
 *
 * Source artwork: scripts/brand/icon.svg. Rendering uses Playwright's bundled Chromium
 * (`page.setContent` + `screenshot`), so no image library is needed. The output is committed;
 * run this again only when the artwork changes:
 *
 *   node scripts/generate-brand-images.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (name) => join(root, "public", name);

/** Ztyle dark tokens (hex), DESIGN 2 / Ztyle 01. */
const C = {
  tile: "#0d0d0d",
  fg: "#f2f2f2",
  muted: "#8c8c8c",
};

const KNIGHT_GROUP = /(<g id="knight"[^>]*>)[\s\S]*?(<\/g>)/;

/**
 * The knight of the piece set (DESIGN 2: "one knight glyph from the piece set"), painted as a
 * white piece: body = tile fill + foreground stroke, eye = foreground dot, details = foreground
 * lines. Node strips the TypeScript types on import. Null when the set is not importable; the
 * copy in icon.svg is used then.
 */
async function pieceSetKnight() {
  try {
    const mod = await import(pathToFileURL(join(root, "src/components/board/pieceShapes.ts")).href);
    const parts = mod.PIECE_SHAPES?.n;
    if (!Array.isArray(parts) || parts.length === 0) return null;
    const markup = parts
      .map((p) => {
        const paint =
          p.kind === "body"
            ? `fill="${C.tile}" stroke="${C.fg}"`
            : p.kind === "dot"
              ? `fill="${C.fg}" stroke="none"`
              : `fill="none" stroke="${C.fg}"`;
        return "circle" in p
          ? `<circle cx="${p.circle[0]}" cy="${p.circle[1]}" r="${p.circle[2]}" ${paint} />`
          : `<path d="${p.d}" ${paint} />`;
      })
      .join("");
    return { markup, stroke: typeof mod.PIECE_STROKE === "number" ? mod.PIECE_STROKE : 3.5 };
  } catch {
    return null;
  }
}

let master = readFileSync(join(root, "scripts/brand/icon.svg"), "utf8")
  .replace(/<\?xml[^>]*>\s*/, "")
  .replace(/<!--[\s\S]*?-->\s*/g, "");

const knight = await pieceSetKnight();
if (knight) {
  master = master
    .replace(KNIGHT_GROUP, (_, open, close) => `${open.replace(/stroke-width="[\d.]+"/, `stroke-width="${knight.stroke}"`)}${knight.markup}${close}`);
  console.log("Knight: from src/components/board/pieceShapes.ts");
} else {
  console.log("Knight: from scripts/brand/icon.svg (piece set not importable)");
}

/** The master SVG at a pixel size, optionally transformed into a variant. */
function iconSvg(size, variant = "full") {
  let svg = master.replace(/width="512" height="512"/, `width="${size}" height="${size}"`);
  if (variant === "maskable") {
    // Maskable icons are cropped to a circle of 80 % diameter: keep the tile full-bleed and
    // scale the motif to 80 %, which puts the 62.5 % board at 50 %, inside the safe circle.
    svg = svg.replace('<g id="motif">', '<g id="motif" transform="translate(256 256) scale(0.8) translate(-256 -256)">');
  }
  if (variant === "small") {
    // Favicon sizes: an 8 × 8 grid at 16 px is noise. Drop it, enlarge the knight, thicken its stroke.
    svg = svg
      .replace('<g id="grid" ', '<g id="grid" display="none" ')
      .replace('<g id="grid-dark" ', '<g id="grid-dark" display="none" ')
      .replace(KNIGHT_GROUP, (_, open, close) =>
        open
          .replace(/scale\([\d.]+\) translate\([-\d. ]+\)/, "scale(4.4) translate(-50 -51)")
          .replace(/stroke-width="[\d.]+"/, 'stroke-width="6"') + _.slice(open.length, -close.length) + close,
      );
  }
  return svg;
}

const page = (body, w, h, extraCss = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${C.tile}; }
  svg { display: block; }
  ${extraCss}
</style></head><body>${body}</body></html>`;

function fontFace(weight) {
  const file = join(root, `node_modules/@fontsource/fira-code/files/fira-code-latin-${weight}-normal.woff2`);
  const data = readFileSync(file).toString("base64");
  return `@font-face { font-family: "Fira Code"; font-weight: ${weight}; font-style: normal;
    src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
}

/** A blurred 8 × 8 board as on the start screen (Ztyle 01: "blurred 8 px at 60 % opacity"). */
function blurredBoard(cell) {
  let squares = "";
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const dark = (r + f) % 2 === 1;
      squares += `<rect x="${f * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${dark ? "#262626" : "#171717"}" />`;
    }
  }
  const side = cell * 8;
  return `<svg width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">${squares}</svg>`;
}

function ogHtml() {
  const css = `
    ${fontFace(300)}
    ${fontFace(400)}
    body {
      font-family: "Fira Code", monospace; color: ${C.fg};
      background-color: ${C.tile};
      background-image: radial-gradient(circle, rgba(242, 242, 242, 0.06) 1px, transparent 1px);
      background-size: 8px 8px;
      display: flex; align-items: center; justify-content: center; position: relative;
    }
    .board { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
             filter: blur(8px); opacity: 0.6; border-radius: 12px; overflow: hidden; }
    .text { position: relative; text-align: center; }
    .mark { font-weight: 300; font-size: 96px; letter-spacing: 0.3em; margin-right: -0.3em; line-height: 1; }
    .tag  { margin-top: 36px; font-size: 36px; color: ${C.muted}; font-weight: 400; }
    .feat { margin-top: 44px; font-size: 24px; color: ${C.muted}; opacity: 0.7; white-space: pre; font-weight: 400; }
  `;
  const body = `
    <div class="board">${blurredBoard(64)}</div>
    <div class="text">
      <div class="mark">ZHESS</div>
      <div class="tag">Zero Distractions. Just Chess.</div>
      <div class="feat">12 computer levels  |  rooms for two  |  zero ads</div>
    </div>`;
  return page(body, 1200, 630, css);
}

/** PNG-in-ICO container (Vista+): header, directory, then the PNG files as they are. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const tab = await ctx.newPage();

  const render = async (html, w, h) => {
    await tab.setViewportSize({ width: w, height: h });
    await tab.setContent(html, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    return tab.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } });
  };

  const icon = (size, variant) => render(page(iconSvg(size, variant), size, size), size, size);

  writeFileSync(pub("pwa-512x512.png"), await icon(512));
  writeFileSync(pub("pwa-192x192.png"), await icon(192));
  writeFileSync(pub("pwa-512x512-maskable.png"), await icon(512, "maskable"));

  const icoImages = [];
  for (const size of [16, 32, 48]) icoImages.push({ size, png: await icon(size, "small") });
  icoImages.push({ size: 256, png: await icon(256) });
  writeFileSync(pub("favicon.ico"), ico(icoImages));

  writeFileSync(pub("og-image.png"), await render(ogHtml(), 1200, 630));

  console.log("Wrote pwa-192x192.png, pwa-512x512.png, pwa-512x512-maskable.png, favicon.ico, og-image.png to public/");
} finally {
  await browser.close();
}
