/**
 * Gate 2 (PLAN.md, milestone 2): the computer opponent on the real build served by `vite preview`
 * (base "./", service worker, the real Stockfish worker). Every scenario of the gate is one test:
 *
 *  - level 1 as white: the engine loads (worker + wasm next to each other under the base URL), the
 *    computer replies within 10 s, ten moves chosen as the first legal move, no console errors;
 *  - as black the computer moves first;
 *  - undo takes back two plies, redo restores them;
 *  - the hint bulb: one square pulses, the second tap another;
 *  - the blunder guard: hanging the queen from a prepared position is refused once, then accepted;
 *  - a 1+0 game: the running clock decreases, a reload loses at most a second; a clock run down
 *    (Playwright's fake clock) ends in `Out of time`; the loss tints the painted page and the
 *    summary counts the flagged turn (DESIGN 8.4, Gate 2 fix round 1);
 *  - offline after the first load: a new computer game still starts (engine from the SW cache).
 */
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import zhess, { encodeMoves } from '../src/lib/zhess';

const ENGINE_JS = 'engine/stockfish-19-lite-single.js';
const ENGINE_WASM = 'engine/stockfish-19-lite-single.wasm';

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

async function skipTutorial(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('zhess:tutorial-seen', 'true');
    } catch {
      /* storage blocked */
    }
  });
}

function cell(page: Page, square: string): Locator {
  return page.getByRole('grid').getByRole('gridcell', { name: new RegExp(`(^|, )${square}(,|$)`) });
}

async function expectPiece(page: Page, square: string, piece: string) {
  await expect(cell(page, square)).toHaveAccessibleName(new RegExp(`^${piece}, ${square}(,|$)`));
}

const stage = (page: Page) => page.getByTestId('stage');
const toolbar = (page: Page) => page.getByRole('toolbar');
const startPill = (page: Page) => page.getByTestId('start-pill');

/** The URL's query (hash router). */
function query(page: Page): URLSearchParams {
  return new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? '');
}

/** UCI moves of the live game, from the address bar (`m`, written on every change). */
function pliesOf(page: Page): string[] {
  const m = query(page).get('m');
  return m ? zhess.decodeMoves(m) : [];
}

async function expectPlies(page: Page, n: number, timeout = 10_000) {
  await expect.poll(() => pliesOf(page).length, { timeout }).toBe(n);
}

/**
 * Taps a move. If the blunder guard refuses it (the piece stays and pulses red), plays the same
 * move again, which confirms it within the 5-second window (DESIGN 7.2).
 */
async function playMove(page: Page, uci: string) {
  const before = pliesOf(page).length;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const refused = page.locator(`[data-square="${from}"] .zhess-blunder`);
  const played = () => pliesOf(page).length > before;
  await cell(page, from).click();
  await cell(page, to).click();
  // Either the move landed or the guard refused it.
  await expect
    .poll(async () => played() || (await refused.count()) > 0, { timeout: 5000 })
    .toBe(true);
  // Refused: the same move again confirms it. A very slow machine may miss the 5 s window once.
  for (let attempt = 0; attempt < 2 && !played(); attempt++) {
    await cell(page, from).click();
    await cell(page, to).click();
    const ok = await expect
      .poll(played, { timeout: 5000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  if (played()) return;
  throw new Error(`move ${uci} was not played`);
}

/** The first legal move (chess.js order) of the live game. */
function firstLegal(page: Page): string {
  const g = zhess.replay(pliesOf(page).map((m) => ({ m, ms: 0 })));
  const moves = zhess.legalMoves(g);
  expect(moves.length).toBeGreaterThan(0);
  return moves[0].uci;
}

/** Start screen preselected by URL (`o`, `d`, `w`, `t`), then the Start pill. */
async function startComputer(page: Page, opts: { color: 'w' | 'b'; tc?: string }) {
  const t = opts.tc ? `&t=${encodeURIComponent(opts.tc)}` : '';
  await page.goto(`./#/?o=c&d=1&w=${opts.color}${t}`);
  await expect(page.getByText('Beginner', { exact: true })).toBeVisible();
  await startPill(page).click();
  await expect(stage(page)).toHaveAttribute('data-phase', 'playing', { timeout: 30_000 });
  await expect(stage(page)).toHaveAttribute('data-engine', 'ready');
}

/** Time on a side's clock in ms (`data-ms` of its strip's timer). */
async function clockMs(page: Page, color: 'w' | 'b'): Promise<number> {
  const v = await page.locator(`[data-color="${color}"] [role="timer"]`).first().getAttribute('data-ms');
  return Number(v);
}

/**
 * The painted colour [r, g, b] of one CSS pixel of the viewport: a screenshot of that pixel,
 * decoded by the page's own canvas (no PNG library needed).
 */
async function pixelAt(page: Page, at: { x: number; y: number }): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: at.x, y: at.y, width: 1, height: 1 }, scale: 'css', animations: 'disabled' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, png.toString('base64'));
}

/* ---------------------------------------------------------------------------------------------- */
/* Scenarios                                                                                 */
/* ---------------------------------------------------------------------------------------------- */

test.describe('milestone 2 · computer', () => {
  let errors: string[];
  test.beforeEach(async ({ context, page }) => {
    await skipTutorial(context);
    errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
  });
  test.afterEach(() => {
    expect(errors, 'no errors in the console').toEqual([]);
  });

  test('level 1 as white: the engine loads, the computer replies within 10 s; ten first-legal moves', async ({ page }) => {
    test.setTimeout(180_000);
    const engineResponses: { url: string; status: number; type: string }[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/engine/')) engineResponses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '' });
    });

    // Pick COMPUTER 1 BEGINNER and white on the start screen itself.
    await page.goto('./#/?w=w');
    const prev = page.getByRole('button', { name: 'Previous opponent' });
    const next = page.getByRole('button', { name: 'Next opponent' });
    const beginner = page.getByText('Beginner', { exact: true });
    // The default is COMPUTER 5; step down to 1.
    for (let i = 0; i < 14 && !(await beginner.isVisible()); i++) {
      if (await page.getByText('Two players', { exact: true }).isVisible()) await next.click();
      else await prev.click();
    }
    await expect(beginner).toBeVisible();
    await startPill(page).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'playing', { timeout: 30_000 });
    await expect(stage(page)).toHaveAttribute('data-engine', 'ready');
    await expect(page.getByRole('group', { name: 'Game info' })).toContainText('1');

    // The worker and its wasm came from next to each other under the page's base URL.
    const base = new URL('./', page.url().split('#')[0]).href;
    await expect.poll(() => engineResponses.map((r) => r.url)).toEqual(expect.arrayContaining([base + ENGINE_JS, base + ENGINE_WASM]));
    for (const r of engineResponses.filter((r) => r.url === base + ENGINE_JS || r.url === base + ENGINE_WASM)) {
      expect(r.status, r.url).toBe(200);
    }
    expect(engineResponses.find((r) => r.url === base + ENGINE_WASM)?.type).toContain('application/wasm');

    for (let i = 0; i < 10; i++) {
      expect(pliesOf(page)).toHaveLength(2 * i);
      await playMove(page, firstLegal(page));
      // The computer replies within 10 s.
      await expectPlies(page, 2 * i + 2, 10_000);
      await expect(stage(page)).not.toHaveAttribute('data-computer', 'thinking');
    }
    expect(pliesOf(page)).toHaveLength(20);
    const g = zhess.replay(pliesOf(page).map((m) => ({ m, ms: 0 })));
    expect(g.end).toBeUndefined();
  });

  test('as black, the computer moves first', async ({ page }) => {
    await startComputer(page, { color: 'b' });
    await expectPlies(page, 1, 10_000);
    await expect(page.getByTestId('board-live')).toHaveText(/^White: /);
    // The board is oriented for black: a8 is at the bottom left.
    const a8 = await cell(page, 'a8').boundingBox();
    const a1 = await cell(page, 'a1').boundingBox();
    expect(a8!.y).toBeGreaterThan(a1!.y);
  });

  test('undo takes back two plies; redo restores them', async ({ page }) => {
    await startComputer(page, { color: 'w' });
    await playMove(page, 'e2e4');
    await expectPlies(page, 2);
    await playMove(page, 'g1f3');
    await expectPlies(page, 4);
    const four = pliesOf(page);

    const undo = toolbar(page).getByRole('button', { name: 'Take back your last move' });
    const redo = toolbar(page).getByRole('button', { name: 'Redo', exact: true });
    await undo.click();
    await expectPlies(page, 2);
    expect(pliesOf(page)).toEqual(four.slice(0, 2));
    await expectPiece(page, 'g1', 'white knight');
    // The computer does not move again: it is the player's turn.
    await page.waitForTimeout(1000);
    expect(pliesOf(page)).toEqual(four.slice(0, 2));

    await redo.click();
    await expectPlies(page, 4);
    expect(pliesOf(page)).toEqual(four);
    await expectPiece(page, 'f3', 'white knight');
  });

  test('hint: one square pulses; a second tap pulses another', async ({ page }) => {
    await startComputer(page, { color: 'w' });
    const hint = toolbar(page).getByRole('button', { name: /^Hint/ });
    const pulsing = page.locator('[data-state~="hint"]');
    await hint.click();
    await expect(pulsing).toHaveCount(1, { timeout: 10_000 });
    await expect(pulsing.locator('.animate-hint-pulse')).toHaveCount(1);
    const first = await pulsing.getAttribute('data-square');
    // The from-square holds a white piece.
    await expect(cell(page, first!)).toHaveAccessibleName(/^white /);

    await hint.click();
    await expect(pulsing).toHaveCount(1);
    await expect(pulsing).not.toHaveAttribute('data-square', first!);
    const second = await pulsing.getAttribute('data-square');
    // The hinted move is legal.
    const legal = zhess.legalMoves(zhess.newGame()).map((m) => m.uci.slice(0, 4));
    expect(legal).toContain(`${first}${second}`);
  });

  test('blunder guard: hanging the queen is refused once and accepted the second time', async ({ page }) => {
    // 1. e4 e5 2. Qh5 Nc6: Qh6?? hangs the queen to gxh6.
    const plies = ['e2e4', 'e7e5', 'd1h5', 'b8c6'].map((m) => ({ m, ms: 0 }));
    await page.goto(`./#/?s=BLUNDR&p=1&o=c&d=1&w=w&m=${encodeMoves(plies)}`);
    await expect(stage(page)).toHaveAttribute('data-phase', 'playing');
    await expectPiece(page, 'h5', 'white queen');
    // Helpers are on by default (the shield); the turn's "before" evaluation loads the engine.
    await expect(toolbar(page).getByRole('button', { name: 'Turn helpers off' })).toBeVisible();
    await expect(stage(page)).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 });
    await page.waitForTimeout(500);

    await cell(page, 'h5').click();
    await cell(page, 'h6').click();
    // Refused: the queen stays and pulses red once; nothing was played.
    await expect(page.locator('[data-square="h5"] .zhess-blunder')).toHaveCount(1);
    await page.waitForTimeout(500);
    await expectPiece(page, 'h5', 'white queen');
    expect(pliesOf(page)).toHaveLength(4);

    // The same move again within 5 s: played.
    await cell(page, 'h5').click();
    await cell(page, 'h6').click();
    await expect.poll(() => pliesOf(page).length, { timeout: 3000 }).toBeGreaterThanOrEqual(5);
    expect(pliesOf(page)[4]).toBe('h5h6');
  });

  test('a 1+0 game: the running clock decreases and a reload loses at most a second', async ({ page }) => {
    await startComputer(page, { color: 'w', tc: '1+0' });
    // Each side's first move is untimed; from white's second turn on the clock runs.
    await playMove(page, 'e2e4');
    await expectPlies(page, 2);
    const timer = page.locator('[data-color="w"] [role="timer"]').first();
    await expect(timer).toHaveAttribute('data-running', 'true');
    const t0 = await clockMs(page, 'w');
    await page.waitForTimeout(1500);
    const t1 = await clockMs(page, 'w');
    expect(t1).toBeLessThan(t0 - 1000);
    // Black's clock does not move while white thinks.
    expect(await clockMs(page, 'b')).toBe(60_000);

    const before = await clockMs(page, 'w');
    await page.reload();
    await expect(timer).toHaveAttribute('data-running', 'true');
    const after = await clockMs(page, 'w');
    // Not reset to the start of the turn (no time gained) and no more than a second lost.
    expect(after).toBeLessThanOrEqual(before);
    expect(before - after).toBeLessThanOrEqual(1000);
    // And it keeps running.
    await page.waitForTimeout(1200);
    expect(await clockMs(page, 'w')).toBeLessThan(after - 1000);
  });

  test('a clock run down from a prepared URL ends in Out of time', async ({ page }) => {
    await page.clock.install();
    const plies = ['e2e4', 'e7e5'].map((m) => ({ m, ms: 0 }));
    await page.goto(`./#/?s=FLAG01&p=1&o=c&d=1&w=w&t=1%2B0&m=${encodeMoves(plies)}`);
    const timer = page.locator('[data-color="w"] [role="timer"]').first();
    await expect(timer).toHaveAttribute('data-running', 'true');
    await expect(stage(page)).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 });
    await page.waitForTimeout(500);
    expect(await clockMs(page, 'w')).toBeGreaterThan(55_000);

    await page.clock.fastForward('01:01');
    await expect(timer).toHaveText('0.0');
    await expect(timer).toHaveAttribute('data-flagged', 'true');
    const overlay = page.getByRole('dialog', { name: 'Out of time' });
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await expect(overlay).toContainText('FLAG01');
    expect(query(page).get('r')).toMatch(/^0-1\.time$/);
  });

  test('a loss on time tints the page red, also after the overlay is dismissed (DESIGN 8.4)', async ({ page }) => {
    await page.clock.install();
    const plies = ['e2e4', 'e7e5'].map((m) => ({ m, ms: 0 }));
    await page.goto(`./#/?s=TINT01&p=1&o=c&d=1&w=w&t=1%2B0&m=${encodeMoves(plies)}`);
    await expect(stage(page)).toHaveAttribute('data-engine', 'ready', { timeout: 30_000 });
    // An empty spot of the stage, left of the board, before the game ends.
    const spot = { x: 5, y: 300 };
    const neutral = await pixelAt(page, spot);

    await page.clock.fastForward('01:05');
    const overlay = page.getByRole('dialog', { name: 'Out of time' });
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    // The summary counts the flagged turn: white's whole minute (it read 0:00 before).
    await expect(overlay).toContainText('TINT01 • Level 1 • 1 move • 1:00');
    await expect(page.locator('[data-tint]')).toHaveAttribute('data-tint', 'destructive');

    // Dismiss the overlay with a scrim tap; the tint stays.
    await page.mouse.click(10, 10);
    await expect(overlay).toBeHidden();
    // The tint fades in over 1 s (fake clock): let it finish, then read the pixel.
    await page.clock.fastForward(2000);
    await expect
      .poll(async () => {
        const [r, g, b] = await pixelAt(page, spot);
        return r - Math.max(g, b);
      }, { timeout: 5000 })
      .toBeGreaterThan(10);
    const tinted = await pixelAt(page, spot);
    expect(tinted, `tinted ${tinted} vs neutral ${neutral}`).not.toEqual(neutral);
  });

  test('offline after the first load, a new computer game still starts', async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.goto('./');
    // Wait for the service worker to control the page.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    // First computer game online: the engine is fetched through the service worker.
    await startComputer(page, { color: 'w' });
    await playMove(page, 'e2e4');
    await expectPlies(page, 2);

    // Runtime-cached in `engine-cache`, and not in the precache.
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const out: Record<string, string[]> = {};
      for (const n of names) out[n] = (await (await caches.open(n)).keys()).map((r) => r.url);
      return out;
    });
    const engineCache = cached['engine-cache'] ?? [];
    expect(engineCache.some((u) => u.endsWith(ENGINE_JS))).toBe(true);
    expect(engineCache.some((u) => u.endsWith(ENGINE_WASM))).toBe(true);
    for (const [name, urls] of Object.entries(cached)) {
      if (name !== 'engine-cache') expect(urls.filter((u) => u.includes('/engine/')), name).toEqual([]);
    }

    // Offline: reload, leave the game, a new code, a new computer game.
    await context.setOffline(true);
    await page.reload();
    await expect(stage(page)).toHaveAttribute('data-phase', 'playing');
    await page.getByRole('button', { name: 'Back to start' }).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'start');
    await page.getByRole('button', { name: /Tap for a new random code/ }).click();
    await expect(startPill(page)).toHaveAttribute('data-label', 'start');
    await startPill(page).click();
    await expect(stage(page)).toHaveAttribute('data-phase', 'playing', { timeout: 30_000 });
    await expect(stage(page)).toHaveAttribute('data-engine', 'ready');
    // The color pill says random (the `w=w` of the first start link is not a remembered choice).
    if (query(page).get('w') === 'b') {
      await expectPlies(page, 1, 10_000);
    } else {
      await playMove(page, 'd2d4');
      await expectPlies(page, 2, 10_000);
    }
    await context.setOffline(false);
  });
});
