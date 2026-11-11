#!/usr/bin/env node
/**
 * Screenshots for the visual pass (PLAN.md section 5, final phase step 4).
 *
 *   node scripts/screenshots.mjs <baseURL> <outDir> [--only start,game,…] [--sizes 390x844,…] [--themes light,dark]
 *
 * Runs against an already running `vite preview` (for example `npx vite preview --port 4180
 * --strictPort` after `npm run build`; baseURL `http://localhost:4180/`). Writes
 * `<screen>-<theme>-<width>x<height>.png` into `outDir`.
 *
 * Screens, each in a fresh browser context with its own seeded localStorage (the app's own
 * `zhess:` storage format, see src/lib/storage.ts and src/lib/types.ts `SavedGame` / `Room`):
 *
 *   start        idle start screen, with history below the fold
 *   dial         start screen with the custom clock dial held open on the clock pill
 *   game         a timed pass-and-play game in progress (captures on both sides)
 *   toast        the same game right after Share copied the link (a sonner toast)
 *   review       a finished computer game in review, three plies back from the end
 *   overlay      pass-and-play game-over overlay (Scholar's Mate played in the session)
 *   overlay-win  computer game won in the session: success tint and overlay
 *   invite       a new room's invite sheet (PeerJS broker blocked, nothing leaves the machine)
 *   history      the history section with several games (scrolled to its heading)
 *   history-end  the same page scrolled to the bottom (more-games button, footer)
 *
 * Sizes: 320×568, 390×844, 844×390 (landscape phone), 1280×800, 2560×1440. The three phone sizes
 * run as touch devices (isMobile, hasTouch, deviceScaleFactor 2), the two desktop sizes with a
 * mouse at scale 1. Dark mode is the system preference (`colorScheme`), which the app follows.
 *
 * Only the app's own origin is contacted: the PeerJS broker WebSocket and HTTP are blocked in every
 * context. Math.random is seeded per context; codes drawn from crypto.getRandomValues still vary.
 */
import { chromium } from '@playwright/test';
import { Chess } from 'chess.js';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* ---------------------------------------------------------------------------------------------- */
/* Arguments                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

const [, , baseArg, outArg] = process.argv;
if (!baseArg || !outArg || baseArg.startsWith('--')) {
  console.error('usage: node scripts/screenshots.mjs <baseURL> <outDir> [--only a,b] [--sizes WxH,…] [--themes light,dark]');
  process.exit(2);
}
const BASE = baseArg.endsWith('/') ? baseArg : `${baseArg}/`;
const OUT = resolve(outArg);

function listArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const ALL_SIZES = [
  { width: 320, height: 568, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 1280, height: 800, touch: false },
  { width: 2560, height: 1440, touch: false },
];
const sizeFilter = listArg('sizes');
const SIZES = sizeFilter ? ALL_SIZES.filter((s) => sizeFilter.includes(`${s.width}x${s.height}`)) : ALL_SIZES;
const THEMES = listArg('themes') ?? ['light', 'dark'];

/* ---------------------------------------------------------------------------------------------- */
/* Prepared games in the app's storage format                                                       */
/* ---------------------------------------------------------------------------------------------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const sq = (s) => (s.charCodeAt(0) - 97) + (Number(s[1]) - 1) * 8;

/** SAN list → `moves` (DESIGN 13.2 compact encoding), validated by chess.js; returns the encoding and the ending. */
function encode(sans) {
  const c = new Chess();
  let out = '';
  for (const san of sans) {
    const m = c.move(san);
    out += B64[sq(m.from)] + B64[sq(m.to)];
    if (m.promotion && m.promotion !== 'q') out += `.${m.promotion}`;
  }
  let end = {};
  if (c.isCheckmate()) end = { result: c.turn() === 'w' ? '0-1' : '1-0', by: 'mate' };
  else if (c.isStalemate()) end = { result: '1/2-1/2', by: 'stalemate' };
  else if (c.isThreefoldRepetition()) end = { result: '1/2-1/2', by: 'repetition' };
  return { moves: out, plies: sans.length, end };
}

/** Plausible per-ply thinking times (ms), deterministic. */
const msFor = (n, base = 4000) => Array.from({ length: n }, (_, i) => base + ((i * 7919) % 9000));

const SCHOLAR6 = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'];
const MAX_LANGE = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd4', 'exd4', 'O-O', 'Nxe4', 'Re1', 'd5', 'Bxd5', 'Qxd5', 'Nc3', 'Qa5', 'Nxe4', 'Be6'];
const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8', 'd4', 'Nbd7'];
const REPEAT = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
const FOOLS = ['f3', 'e5', 'g4', 'Qh4#'];
const SICILIAN = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6'];

/**
 * One SavedGame. `ago` is minutes before page load (resolved in the page, so relative times read
 * naturally); `extra` overrides fields.
 */
function game(id, mode, sans, extra = {}) {
  const e = encode(sans);
  return {
    id,
    code: id.split('.')[0],
    mode,
    color: 'w',
    tc: null,
    moves: e.moves,
    ms: msFor(e.plies),
    ...e.end,
    assisted: false,
    ago: 5,
    ...extra,
  };
}

/** Games for the history screen: every card kind (DESIGN 12.2). More than five, so `N more games` shows. */
const HISTORY_GAMES = [
  game('K7QW2M', 'local', MAX_LANGE, { tc: '5+0', ago: 3 }),
  game('R00M42.2', 'room', SICILIAN, { color: 'b', tc: '10+0', room: { n: 2, epoch: 0 }, ago: 20 }),
  game('R00M42.1', 'room', FOOLS, { color: 'b', room: { n: 1, epoch: 0 }, ago: 60 }),
  game('C4FE88', 'computer', SCHOLAR6.concat('Qxf7#'), { level: 3, assisted: true, ago: 180 }),
  game('LOST12', 'computer', RUY, { level: 8, color: 'b', tc: '3+2', result: '1-0', by: 'resign', ago: 60 * 26 }),
  game('DRAW77', 'local', REPEAT, { ago: 60 * 24 * 3 }),
  game('TIME01', 'computer', SICILIAN.slice(0, 10), { level: 12, color: 'w', tc: '1+0', result: '0-1', by: 'time', ago: 60 * 24 * 9 }),
  game('ZEN000', 'computer', RUY.slice(0, 12), { level: 5, ago: 60 * 24 * 40 }),
];

const HISTORY_ROOMS = [
  {
    code: 'R00M42',
    key: 'q2Zt8vXcR1mK0aBdE3fGhw',
    seat: 1,
    createdAt: -90, // minutes ago, resolved in the page
    lastSeenAt: -20,
    score: [0, 2], // seat 1 won game 1 (Fool's Mate as black)
    games: ['R00M42.1', 'R00M42.2'],
  },
];

const PREFS = {
  'tutorial-seen': true,
  'donation-shown': true,
  'install-dismissed': true,
  lang: 'en',
};

/* ---------------------------------------------------------------------------------------------- */
/* Browser helpers                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

/** A fresh context: seeded storage (once per context), seeded Math.random, broker blocked. */
async function newContext(browser, size, theme, seed) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.touch ? 2 : 1,
    isMobile: size.touch,
    hasTouch: size.touch,
    colorScheme: theme,
    locale: 'en-US',
    baseURL: BASE,
  });
  await context.addInitScript((data) => {
    // Seeded Math.random (mulberry32), so anything drawn from it repeats between runs.
    let a = 0x5eed;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // The native share sheet cannot be driven; Share falls back to the clipboard.
    try {
      Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
    } catch {
      /* ignore */
    }
    try {
      if (sessionStorage.getItem('shots:seeded')) return;
      sessionStorage.setItem('shots:seeded', '1');
      const now = Date.now();
      const min = 60_000;
      for (const [k, v] of Object.entries(data.prefs)) localStorage.setItem(`zhess:${k}`, JSON.stringify(v));
      if (data.games.length) {
        const games = data.games.map(({ ago, ...g }) => ({
          ...g,
          createdAt: now - (ago + 30) * min,
          lastPlayedAt: now - ago * min,
        }));
        localStorage.setItem('zhess:games', JSON.stringify(games));
      }
      if (data.rooms.length) {
        const rooms = data.rooms.map((r) => ({ ...r, createdAt: now + r.createdAt * min, lastSeenAt: now + r.lastSeenAt * min }));
        localStorage.setItem('zhess:rooms', JSON.stringify(rooms));
      }
    } catch {
      /* storage blocked */
    }
  }, { prefs: { ...PREFS, ...(seed.prefs ?? {}) }, games: seed.games ?? [], rooms: seed.rooms ?? [] });
  await context.routeWebSocket(/peerjs/, (ws) => ws.close());
  await context.route(/peerjs\.com/, (route) => route.abort());
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  return context;
}

const cell = (page, square) =>
  page.getByRole('grid').getByRole('gridcell', { name: new RegExp(`(^|, )${square}(,|$)`) });

async function tapMove(page, from, to) {
  await cell(page, from).click();
  await cell(page, to).click();
}

async function settle(page, ms = 700) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

/** Opens a stored game by its code from the start screen (Resume / Review pill). */
async function openStored(page, code, label) {
  await page.goto(`./#/?s=${code}`);
  const pill = page.getByRole('button', { name: label, exact: true });
  await pill.waitFor({ state: 'visible', timeout: 15_000 });
  await pill.click();
  await page.getByRole('toolbar').waitFor({ state: 'visible', timeout: 30_000 });
}

/* ---------------------------------------------------------------------------------------------- */
/* Screens                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const SCREENS = {
  async start(page) {
    await page.goto('./');
    await page.getByTestId('stage').waitFor();
    await settle(page);
  },

  async dial(page) {
    await page.goto('./');
    const pill = page.getByTestId('clock-pill');
    await pill.waitFor();
    await settle(page, 300);
    const box = await pill.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    return async () => {
      await page.mouse.up().catch(() => {});
    };
  },

  async game(page) {
    await openStored(page, 'K7QW2M', 'Resume');
    await settle(page, 900);
  },

  async toast(page) {
    await openStored(page, 'K7QW2M', 'Resume');
    await settle(page, 300);
    await page.getByRole('toolbar').getByRole('button', { name: 'Share game' }).click();
    await page.getByText('Link copied to clipboard!').waitFor({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
  },

  async review(page) {
    await openStored(page, 'LOST12', 'Review');
    await settle(page, 300);
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(120);
    }
    await settle(page, 500);
  },

  async overlay(page) {
    await openStored(page, 'MATE01', 'Resume');
    await settle(page, 300);
    await tapMove(page, 'h5', 'f7');
    await page.getByRole('dialog', { name: /wins|Draw|Checkmate/ }).waitFor({ timeout: 10_000 });
    await settle(page, 800);
  },

  async 'overlay-win'(page) {
    await openStored(page, 'WIN001', 'Resume');
    await settle(page, 600);
    await tapMove(page, 'h5', 'f7');
    await page.getByRole('dialog', { name: /won|Checkmate/ }).waitFor({ timeout: 20_000 });
    await settle(page, 1200);
  },

  async invite(page) {
    await page.goto('./#/?s=NV1TE5');
    const value = page.getByText('Room', { exact: true });
    await value.waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const sheet = page.getByTestId('invite-sheet');
    await sheet.waitFor({ timeout: 15_000 });
    // With the broker blocked the sheet settles on `Connect manually`.
    await sheet.getByRole('button', { name: 'Connect manually' }).waitFor({ timeout: 25_000 }).catch(() => {});
    await settle(page, 600);
  },

  async history(page) {
    await page.goto('./');
    await page.getByTestId('stage').waitFor();
    await settle(page, 300);
    const heading = page.getByRole('heading', { name: 'Previous games' });
    await page.mouse.move(10, 10);
    for (let i = 0; i < 6 && !(await heading.isVisible()); i++) {
      await page.mouse.wheel(0, page.viewportSize().height * 0.8);
      await page.waitForTimeout(250);
    }
    await heading.scrollIntoViewIfNeeded();
    await settle(page, 900);
  },

  async 'history-end'(page) {
    await SCREENS.history(page);
    await page.mouse.wheel(0, 20_000);
    await settle(page, 900);
  },
};

/** What each screen's context holds. */
const SEEDS = {
  start: { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
  dial: { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
  game: { games: [game('K7QW2M', 'local', MAX_LANGE, { tc: '5+0', ms: msFor(18, 6000) })] },
  toast: { games: [game('K7QW2M', 'local', MAX_LANGE, { tc: '5+0', ms: msFor(18, 6000) })] },
  review: { games: [HISTORY_GAMES[4]] },
  overlay: { games: [game('MATE01', 'local', SCHOLAR6, { tc: '3+2' })] },
  'overlay-win': { games: [game('WIN001', 'computer', SCHOLAR6, { level: 1, tc: '10+0' })] },
  invite: { prefs: { opponent: { mode: 'room' }, color: 'w', clock: 'off' } },
  history: { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
  'history-end': { games: HISTORY_GAMES, rooms: HISTORY_ROOMS },
};

/* ---------------------------------------------------------------------------------------------- */
/* Run                                                                                              */
/* ---------------------------------------------------------------------------------------------- */

const only = listArg('only');
const names = Object.keys(SCREENS).filter((n) => !only || only.includes(n));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
let failed = 0;
try {
  for (const name of names) {
    for (const size of SIZES) {
      for (const theme of THEMES) {
        const file = join(OUT, `${name}-${theme}-${size.width}x${size.height}.png`);
        const context = await newContext(browser, size, theme, SEEDS[name]);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        try {
          const result = await SCREENS[name](page);
          await page.screenshot({ path: file, animations: 'disabled' });
          if (typeof result === 'function') await result();
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          console.log(`ok   ${file}${overflow > 0 ? `  (horizontal overflow ${overflow}px)` : ''}${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`);
        } catch (e) {
          failed++;
          await page.screenshot({ path: file.replace(/\.png$/, '.failed.png') }).catch(() => {});
          console.log(`FAIL ${file}: ${e.message.split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
