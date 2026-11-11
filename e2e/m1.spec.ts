/**
 * Gate 1 (PLAN.md, milestone 1): pass-and-play end to end on the real build, at a phone and a
 * desktop viewport. Every scenario of the gate is one test per viewport; the screenshots for the
 * verifier are written to docs/screenshots/m1/.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { encodeMoves } from '../src/lib/zhess';

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const SHOTS = 'docs/screenshots/m1';

const SCHOLARS_MATE: [string, string][] = [
  ['e2', 'e4'],
  ['e7', 'e5'],
  ['f1', 'c4'],
  ['b8', 'c6'],
  ['d1', 'h5'],
  ['g8', 'f6'],
  ['h5', 'f7'],
];

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** The tutorial is covered by unit tests; here it would only sit on top of the board. */
async function skipTutorial(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('zhess:tutorial-seen', 'true');
    } catch {
      /* storage blocked: the tutorial is dismissed by a tap below */
    }
  });
}

/** A square of the board grid, found by its accessible name (`white knight, g1` or `e4`). */
function cell(page: Page, square: string): Locator {
  return page.getByRole('grid').getByRole('gridcell', { name: new RegExp(`(^|, )${square}(,|$)`) });
}

async function expectPiece(page: Page, square: string, piece: string) {
  await expect(cell(page, square)).toHaveAccessibleName(new RegExp(`^${piece}, ${square}(,|$)`));
}

async function expectEmpty(page: Page, square: string) {
  await expect(cell(page, square)).toHaveAccessibleName(new RegExp(`^${square}(,|$)`));
}

async function tapMove(page: Page, from: string, to: string) {
  await cell(page, from).click();
  await cell(page, to).click();
  // The move landed: the source square is empty.
  await expectEmpty(page, from);
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragMove(page: Page, from: string, to: string) {
  const a = await center(cell(page, from));
  const b = await center(cell(page, to));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await expectEmpty(page, from);
}

/** Code of the open game, from the address bar (`s`). */
function codeOf(page: Page): string {
  const query = new URL(page.url()).hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('s') ?? '';
}

const toolbar = (page: Page) => page.getByRole('toolbar');
const startPill = (page: Page, label = 'Start') => page.getByRole('button', { name: label, exact: true });

/** Start screen → TWO PLAYERS → Start. */
async function startTwoPlayers(page: Page) {
  await page.goto('./');
  const value = page.getByText('Two players', { exact: true });
  const prev = page.getByRole('button', { name: 'Previous opponent' });
  for (let i = 0; i < 14 && !(await value.isVisible()); i++) await prev.click();
  await expect(value).toBeVisible();
  await startPill(page).click();
  await expect(toolbar(page)).toBeVisible();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-phase', 'playing');
  await expectPiece(page, 'e2', 'white pawn');
}

async function playScholarsMate(page: Page) {
  for (const [from, to] of SCHOLARS_MATE) await tapMove(page, from, to);
}

const gameOver = (page: Page) => page.getByRole('dialog', { name: /wins|Draw|Checkmate/ });

async function backToStart(page: Page) {
  await page.getByRole('button', { name: 'Back to start' }).click();
  await expect(page.getByTestId('stage')).toHaveAttribute('data-phase', 'start');
}

async function scrollToHistory(page: Page) {
  // The bounce chevron is always moving; scroll the way a user does.
  await expect(page.getByRole('button', { name: 'Show previous games' })).toBeVisible();
  await page.mouse.move(10, 10);
  await page.mouse.wheel(0, page.viewportSize()?.height ?? 800);
  await expect(page.getByRole('heading', { name: 'Previous games' })).toBeVisible();
}

function historyCard(page: Page, code: string): Locator {
  return page.getByTestId('history-card').filter({ hasText: code });
}

/* ---------------------------------------------------------------------------------------------- */
/* Scenarios                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

for (const vp of VIEWPORTS) {
  test.describe(`milestone 1 @ ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    let errors: string[];
    test.beforeEach(async ({ context, page }) => {
      await skipTutorial(context);
      errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
    });
    test.afterEach(() => {
      expect(errors, 'no uncaught page errors').toEqual([]);
    });

    test("Scholar's Mate by tap-tap ends with White wins!", async ({ page }) => {
      await startTwoPlayers(page);
      await playScholarsMate(page);
      await expectPiece(page, 'f7', 'white queen');
      const overlay = gameOver(page);
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText('White wins!');
      await expect(overlay.getByRole('button', { name: 'New game' })).toBeVisible();
    });

    test('three drag moves, undo twice, redo once: the position matches', async ({ page }) => {
      await startTwoPlayers(page);
      await dragMove(page, 'e2', 'e4');
      await dragMove(page, 'e7', 'e5');
      await dragMove(page, 'g1', 'f3');
      await expectPiece(page, 'f3', 'white knight');

      const undo = toolbar(page).getByRole('button', { name: 'Undo', exact: true });
      const redo = toolbar(page).getByRole('button', { name: 'Redo', exact: true });
      await undo.click();
      await expectPiece(page, 'g1', 'white knight');
      await undo.click();
      await expectPiece(page, 'e7', 'black pawn');
      await expectEmpty(page, 'e5');
      await redo.click();

      // After 1. e4 e5: both pawns advanced, the knight home, one more redo left.
      await expectPiece(page, 'e4', 'white pawn');
      await expectPiece(page, 'e5', 'black pawn');
      await expectEmpty(page, 'e2');
      await expectEmpty(page, 'e7');
      await expectPiece(page, 'g1', 'white knight');
      await expectEmpty(page, 'f3');
      await expect(redo).toBeEnabled();
      await expect(page).toHaveURL(new RegExp(`m=${encodeMoves([{ m: 'e2e4', ms: 0 }, { m: 'e7e5', ms: 0 }])}(&|$)`));
    });

    test('typing e4 on the keyboard moves the pawn', async ({ page }) => {
      await startTwoPlayers(page);
      await page.keyboard.type('e4');
      await page.keyboard.press('Enter');
      await expectPiece(page, 'e4', 'white pawn');
      await expectEmpty(page, 'e2');
      await expect(page.getByTestId('board-live')).toHaveText('White: pawn to e4');
    });

    test('promotes to a knight with the dial from a prepared URL', async ({ page }) => {
      const plies = ['a2a4', 'h7h5', 'a4a5', 'h5h4', 'a5a6', 'h4h3', 'a6b7', 'h3g2'].map((m) => ({ m, ms: 0 }));
      await page.goto(`./#/?s=PROMO1&p=1&o=l&m=${encodeMoves(plies)}`);
      await expectPiece(page, 'b7', 'white pawn');
      await expectPiece(page, 'c8', 'black bishop');

      // Drag the pawn onto c8 and hold it there: the dial opens after 300 ms.
      const a = await center(cell(page, 'b7'));
      const b = await center(cell(page, 'c8'));
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 10 });
      const dial = page.getByRole('menu', { name: 'Promote to' });
      for (const piece of [/queen/i, /rook/i, /bishop/i, /knight/i]) {
        await expect(dial.getByRole('menuitem', { name: piece })).toBeVisible();
      }

      // The knight sits at 9 o'clock of the dial's center (a 0×0 anchor): aim past the commit radius and release.
      const c = await dial.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top };
      });
      await page.mouse.move(c.x - 70, c.y, { steps: 6 });
      await page.mouse.up();

      await expect(dial.getByRole('menuitem')).toHaveCount(0);
      await expectPiece(page, 'c8', 'white knight');
      await expectEmpty(page, 'b7');
      await expect(page).toHaveURL(/\.n(&|$)/);
    });

    test('reload keeps the position; Back lists it as unfinished; resume works', async ({ page }) => {
      await startTwoPlayers(page);
      await tapMove(page, 'e2', 'e4');
      await tapMove(page, 'e7', 'e5');
      await tapMove(page, 'g1', 'f3');
      const code = codeOf(page);
      expect(code).toMatch(/^[0-9A-Z]{6}$/);

      await page.reload();
      await expect(toolbar(page)).toBeVisible();
      await expectPiece(page, 'e4', 'white pawn');
      await expectPiece(page, 'e5', 'black pawn');
      await expectPiece(page, 'f3', 'white knight');
      expect(codeOf(page)).toBe(code);

      await backToStart(page);
      await expect(startPill(page, 'Resume')).toBeVisible();
      await scrollToHistory(page);
      const card = historyCard(page, code);
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('Black to move');
      await expect(card).toContainText('2 moves');

      await card.click();
      await expect(page.getByTestId('stage')).toHaveAttribute('data-phase', 'playing');
      await expectPiece(page, 'f3', 'white knight');
      await tapMove(page, 'b8', 'c6');
      await expectPiece(page, 'c6', 'black knight');
      expect(codeOf(page)).toBe(code);
    });

    test('a finished game opens in review; stepping works; continue from here starts a new game', async ({ page }) => {
      await startTwoPlayers(page);
      await playScholarsMate(page);
      const code = codeOf(page);
      await expect(gameOver(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(gameOver(page)).toBeHidden();
      await backToStart(page);
      await expect(startPill(page, 'Review')).toBeVisible();

      await scrollToHistory(page);
      const card = historyCard(page, code);
      await expect(card).toContainText('1–0');
      await card.click();

      const stage = page.getByTestId('stage');
      await expect(stage).toHaveAttribute('data-phase', 'review');
      await expect(gameOver(page)).toBeHidden();
      await expectPiece(page, 'f7', 'white queen');

      const back = toolbar(page).getByRole('button', { name: /^Previous move/ });
      const forward = toolbar(page).getByRole('button', { name: /^Next move/ });
      await back.click();
      await expectPiece(page, 'h5', 'white queen');
      await expectPiece(page, 'f7', 'black pawn');
      await forward.click();
      await expectPiece(page, 'f7', 'white queen');
      await back.click();
      await back.click();
      await expectEmpty(page, 'f6');
      await expectPiece(page, 'g8', 'black knight');
      // The board is read-only in review.
      await cell(page, 'g8').click();
      await cell(page, 'f6').click();
      await expectEmpty(page, 'f6');

      await toolbar(page).getByRole('button', { name: 'Continue from here' }).click();
      await expect(stage).toHaveAttribute('data-phase', 'playing');
      const fresh = codeOf(page);
      expect(fresh).toMatch(/^[0-9A-Z]{6}$/);
      expect(fresh).not.toBe(code);
      await expectPiece(page, 'h5', 'white queen');
      // A live game from that position: black is to move and can play.
      await tapMove(page, 'g7', 'g6');
      await expectPiece(page, 'g6', 'black pawn');
    });

    test('a share URL with moves opens the position in a fresh context', async ({ page, context, browser }) => {
      await context.addInitScript(() => {
        // Force the clipboard path of Share (the native share sheet cannot be driven).
        Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true });
      });
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await startTwoPlayers(page);
      await tapMove(page, 'e2', 'e4');
      await tapMove(page, 'c7', 'c5');
      await tapMove(page, 'g1', 'f3');

      await toolbar(page).getByRole('button', { name: 'Share game' }).click();
      await expect(page.getByText('Link copied to clipboard!')).toBeVisible();
      const url = await page.evaluate(() => navigator.clipboard.readText());
      expect(url).toContain('m=');

      const other = await freshPage(browser, vp);
      try {
        await other.goto(url);
        await expect(other.getByRole('toolbar')).toBeVisible();
        await expectPiece(other, 'e4', 'white pawn');
        await expectPiece(other, 'c5', 'black pawn');
        await expectPiece(other, 'f3', 'white knight');
        await expectEmpty(other, 'g1');
      } finally {
        await other.context().close();
      }
    });

    for (const theme of ['light', 'dark'] as const) {
      test(`screenshots: start, game, overlay and history (${theme})`, async ({ page }) => {
        const shot = (name: string) =>
          page.screenshot({ path: `${SHOTS}/${name}-${theme}-${vp.width}x${vp.height}.png`, animations: 'disabled' });
        await page.emulateMedia({ colorScheme: theme });

        // An unfinished game first, so history has both kinds of card.
        await startTwoPlayers(page);
        await tapMove(page, 'd2', 'd4');
        await tapMove(page, 'd7', 'd5');
        await tapMove(page, 'c2', 'c4');
        await tapMove(page, 'd5', 'c4');
        await backToStart(page);

        // A new code: the pill turns from Resume back to Start.
        await expect(startPill(page, 'Resume')).toBeVisible();
        await page.getByRole('button', { name: /Tap for a new random code/ }).click();
        await expect(startPill(page)).toBeVisible();
        await page.waitForTimeout(600);
        await shot('start');

        await startPill(page).click();
        await expect(toolbar(page)).toBeVisible();
        for (const [from, to] of SCHOLARS_MATE.slice(0, 6)) await tapMove(page, from, to);
        await page.waitForTimeout(600);
        await shot('game');

        await tapMove(page, 'h5', 'f7');
        await expect(gameOver(page)).toBeVisible();
        await page.waitForTimeout(600);
        await shot('overlay');

        await page.keyboard.press('Escape');
        await backToStart(page);
        await scrollToHistory(page);
        await expect(page.getByTestId('history-card')).toHaveCount(2);
        await page.waitForTimeout(800);
        await shot('history');
      });
    }
  });
}

async function freshPage(browser: Browser, vp: (typeof VIEWPORTS)[number]): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, baseURL: 'http://localhost:4173' });
  await skipTutorial(ctx);
  return ctx.newPage();
}
