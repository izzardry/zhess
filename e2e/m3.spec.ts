/**
 * Gate 3 (PLAN.md, milestone 3): rooms between two isolated browser contexts (two devices) on the
 * real build served by `vite preview`, over real WebRTC data channels.
 *
 *  - Manual path (must pass, no third party): the PeerJS broker is blocked in both contexts, so the
 *    room offers `Connect manually` (DESIGN 9.9). The host's offer link goes to the guest context,
 *    the guest's answer link comes back through the paste field. Then: the guest sees the host's
 *    first move; four moves each way; a takeback asked and accepted; a draw offered and declined;
 *    resign; rematch with swapped colors; score `1 – 0`.
 *  - Recovery (must pass): during a game the guest's storage is cleared and the page reloaded; the
 *    guest starts the same code with ROOM, the host allows the rejoin, and the guest shows the same
 *    position and finds the earlier finished game in its history (DESIGN 9.5).
 *  - Offline move (must pass, manual transport): untimed game, the guest page closes, the host moves,
 *    the guest page comes back, the move arrives on reconnect (DESIGN 9.6).
 *  - BroadcastChannel hand-over (DESIGN 9.9 step 3): the answer link opened in a second tab of the
 *    host's context hands the answer to the waiting tab, which connects. BroadcastChannel does not
 *    cross contexts, so this runs as two pages of one context.
 *  - Broker path (best effort): the same join through the public PeerJS broker. Skipped at runtime
 *    only when the app classifies the broker as unreachable (or rate-limited, which PeerJS reports
 *    as a server error, classified the same way); otherwise it asserts a real game over the broker.
 *
 * Only public STUN servers and, in the broker test, the public PeerJS broker are contacted. Codes
 * are random per run; nothing personal is sent.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/* ---------------------------------------------------------------------------------------------- */
/* Helpers                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

/** A fresh 6-character room code per test run, so runs never meet each other's rooms. */
function randomCode(): string {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

interface Device {
  context: BrowserContext;
  page: Page;
}

/**
 * A device: an isolated browser context with the tutorial and the one-time donation prompt already
 * seen (the prompt follows the first win and would cover the overlay's Rematch). `broker: false` blocks the
 * PeerJS broker's WebSocket, so nothing but STUN leaves the machine (the app then classifies the
 * broker as unreachable and offers the manual exchange).
 */
async function device(browser: Browser, opts: { broker: boolean }): Promise<Device> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    try {
      localStorage.setItem('zhess:tutorial-seen', 'true');
      localStorage.setItem('zhess:donation-shown', 'true');
    } catch {
      /* storage blocked */
    }
  });
  if (!opts.broker) {
    await context.routeWebSocket(/peerjs/, (ws) => ws.close());
    await context.route(/peerjs\.com/, (route) => route.abort());
  }
  const page = await context.newPage();
  return { context, page };
}

const stage = (page: Page) => page.getByTestId('stage');
const toolbar = (page: Page) => page.getByRole('toolbar');
const startPill = (page: Page) => page.getByRole('button', { name: 'Start', exact: true });

function cell(page: Page, square: string): Locator {
  return page.getByRole('grid').getByRole('gridcell', { name: new RegExp(`(^|, )${square}(,|$)`) });
}

async function expectPiece(page: Page, square: string, piece: string, timeout = 15_000) {
  await expect(cell(page, square)).toHaveAccessibleName(new RegExp(`^${piece}, ${square}(,|$)`), { timeout });
}

async function expectEmpty(page: Page, square: string, timeout = 15_000) {
  await expect(cell(page, square)).toHaveAccessibleName(new RegExp(`^${square}(,|$)`), { timeout });
}

async function tapMove(page: Page, uci: string) {
  await cell(page, uci.slice(0, 2)).click();
  await cell(page, uci.slice(2, 4)).click();
}

/** `mover` plays `uci`; `watcher` sees the piece arrive. */
async function playAndSee(mover: Page, watcher: Page, uci: string, piece: string) {
  await tapMove(mover, uci);
  await expectPiece(mover, uci.slice(2, 4), piece);
  await expectPiece(watcher, uci.slice(2, 4), piece);
}

/** Start screen → opponent ROOM → (color) → Start: create or join the room of `code` (DESIGN 9.2). */
async function startRoom(page: Page, code: string, color?: 'w' | 'b') {
  await page.goto(`./#/?s=${code}${color ? `&w=${color}` : ''}`);
  const value = page.getByText('Room', { exact: true });
  const prev = page.getByRole('button', { name: 'Previous opponent' });
  for (let i = 0; i < 16 && !(await value.isVisible()); i++) await prev.click();
  await expect(value).toBeVisible();
  await startPill(page).click();
  await expect(stage(page)).toHaveAttribute('data-phase', 'playing');
}

async function expectConnected(...pages: Page[]) {
  for (const p of pages) await expect(stage(p)).toHaveAttribute('data-room-presence', 'connected', { timeout: 30_000 });
}

/** The read-only link field of a sheet. */
async function linkIn(sheet: Locator): Promise<string> {
  const field = sheet.getByRole('textbox', { name: 'Invite link' });
  await expect(field).toHaveValue(/#\/\?s=/, { timeout: 15_000 });
  return field.inputValue();
}

/**
 * Host: `Connect manually` (from the invite sheet, opened by itself or through the presence dot)
 * and returns the offer link (DESIGN 9.9 step 1).
 */
async function hostOffer(host: Page): Promise<string> {
  const invite = host.getByTestId('invite-sheet');
  // The creator's invite sheet opens by itself; otherwise the presence dot opens it.
  if (!(await invite.isVisible())) await host.getByRole('button', { name: /Show invite$/ }).click({ timeout: 15_000 });
  await expect(invite).toBeVisible();
  // The broker is blocked: the app classifies it as unreachable and offers the manual exchange.
  const connect = invite.getByRole('button', { name: 'Connect manually' });
  await expect(connect).toBeVisible({ timeout: 20_000 });
  // The sheet carries the cause and the button; the failure toast does not repeat them over it.
  await expect(host.getByText('Could not reach the connection service.')).toHaveCount(1);
  await expect(host.getByRole('button', { name: 'Connect manually' })).toHaveCount(1);
  await connect.click();
  const sheet = host.getByTestId('manual-sheet');
  await expect(sheet.getByText('Step 1 of 2')).toBeVisible({ timeout: 15_000 });
  await expect(host.getByText('Could not reach the connection service.')).toHaveCount(0);
  const offer = await linkIn(sheet);
  expect(offer).toMatch(/[?&]o=r&x=/);
  return offer;
}

/** Guest: the answer link for an offer link opened in this page (DESIGN 9.9 step 2). */
async function guestAnswer(guest: Page): Promise<string> {
  const sheet = guest.getByTestId('manual-sheet');
  await expect(sheet.getByText('Send this link back to your opponent')).toBeVisible({ timeout: 15_000 });
  // The guest of a manual exchange is never offered `Connect manually` (no failure toast).
  await expect(guest.getByRole('button', { name: 'Connect manually' })).toHaveCount(0);
  const answer = await linkIn(sheet);
  expect(answer).toMatch(/&y=/);
  return answer;
}

/** Host: pastes the answer link into the waiting sheet (the paste path of DESIGN 9.9 step 3). */
async function hostPaste(host: Page, answer: string) {
  const sheet = host.getByTestId('manual-sheet');
  await sheet.getByRole('textbox', { name: 'Answer link' }).fill(answer);
  await sheet.getByRole('button', { name: 'Connect', exact: true }).click();
}

/** Opens a link in a page that already runs the app, as a same-document hash change (no reload). */
async function openInPlace(page: Page, link: string) {
  await page.evaluate((url) => {
    window.location.hash = new URL(url).hash;
  }, link);
}

/** The whole manual exchange: host offer → guest (page.goto or in place) → answer → host paste → connected. */
async function connectManually(host: Page, guest: Page, opts: { guestInPlace?: boolean } = {}) {
  const offer = await hostOffer(host);
  if (opts.guestInPlace) await openInPlace(guest, offer);
  else await guest.goto(offer);
  const answer = await guestAnswer(guest);
  await hostPaste(host, answer);
  await expectConnected(host, guest);
  // Both ends run over the manual data channel; the transient `x` / `y` left the address bar.
  await expect(stage(host)).toHaveAttribute('data-room-via', 'manual');
  await expect(stage(guest)).toHaveAttribute('data-room-via', 'manual');
  expect(guest.url()).not.toMatch(/[?&][xy]=/);
}

/** Holds a toolbar button (resign: 500 ms, DESIGN 8.3). */
async function hold(page: Page, button: Locator, ms = 900) {
  const box = await button.boundingBox();
  if (!box) throw new Error('button not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const incoming = (page: Page, text: string) => page.getByRole('alertdialog', { name: text });

/** The info pill's score cell (`2 – 1`, this device's points first). */
async function expectScore(page: Page, score: string) {
  await expect(page.getByText(score, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

/** Host creates the room as white with the broker blocked; returns both devices, connected manually. */
async function manualRoom(browser: Browser, code: string): Promise<{ host: Device; guest: Device }> {
  const host = await device(browser, { broker: false });
  const guest = await device(browser, { broker: false });
  await startRoom(host.page, code, 'w');
  await expect(stage(host.page)).toHaveAttribute('data-room-cause', 'broker-unreachable', { timeout: 20_000 });
  await connectManually(host.page, guest.page);
  return { host, guest };
}

/* ---------------------------------------------------------------------------------------------- */
/* Scenarios                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

test.describe('Gate 3 · rooms', () => {
  test.describe.configure({ timeout: 180_000 });

  test('manual path: offer, answer, a full game with takeback, draw offer, resign, rematch and score', async ({ browser }) => {
    const code = randomCode();
    const { host, guest } = await manualRoom(browser, code);
    const h = host.page;
    const g = guest.page;
    // The guest joined with the creator's settings: white for the host, black for the guest.
    await expect(cell(g, 'a1')).toBeVisible();
    // The room address carries the code only, never moves (DESIGN 13.2).
    expect(new URL(h.url()).hash).toBe(`#/?s=${code}&p=1&o=r`);
    expect(new URL(g.url()).hash).toBe(`#/?s=${code}&p=1&o=r`);

    // The guest sees the host's first move; then four moves each way.
    await playAndSee(h, g, 'e2e4', 'white pawn');
    await playAndSee(g, h, 'e7e5', 'black pawn');
    await playAndSee(h, g, 'g1f3', 'white knight');
    await playAndSee(g, h, 'b8c6', 'black knight');
    await playAndSee(h, g, 'f1c4', 'white bishop');
    await playAndSee(g, h, 'g8f6', 'black knight');
    await playAndSee(h, g, 'd2d3', 'white pawn');
    await playAndSee(g, h, 'f8c5', 'black bishop');

    // Takeback: the guest asks (the undo slot), the host accepts the toast (DESIGN 9.7).
    await toolbar(g).getByRole('button', { name: 'Ask for a takeback' }).click();
    await expect(toolbar(g).getByRole('button', { name: 'Takeback requested' })).toBeVisible();
    const takeback = incoming(h, 'Your opponent asks for a takeback');
    await expect(takeback).toBeVisible({ timeout: 15_000 });
    await takeback.getByRole('button', { name: 'Accept' }).click();
    for (const p of [h, g]) {
      await expectEmpty(p, 'c5');
      await expectPiece(p, 'f8', 'black bishop');
      await expectPiece(p, 'd3', 'white pawn');
    }
    await playAndSee(g, h, 'f8e7', 'black bishop');

    // Draw: the host offers (flag tap), the guest declines; the host hears so.
    await toolbar(h).getByRole('button', { name: 'Offer a draw (hold to resign)' }).click();
    const draw = incoming(g, 'Your opponent offers a draw');
    await expect(draw).toBeVisible({ timeout: 15_000 });
    // The host's pending state is on the flag, not in a toast over the toolbar (DESIGN 9.7).
    await expect(toolbar(h).getByRole('button', { name: 'Draw offered (hold to resign)' })).toBeVisible();
    await expect(h.getByText('Waiting for your opponent', { exact: true })).toHaveCount(0);
    await draw.getByRole('button', { name: 'Decline' }).click();
    await expect(h.getByText('Draw declined')).toBeVisible({ timeout: 15_000 });
    await expect(toolbar(h).getByRole('button', { name: 'Offer a draw (hold to resign)' })).toBeVisible();
    await expect(stage(h)).toHaveAttribute('data-phase', 'playing');

    // Resign: the guest holds the flag. Final in a room: no undo toast.
    await hold(g, toolbar(g).getByRole('button', { name: 'Offer a draw (hold to resign)' }));
    const won = h.getByRole('dialog', { name: /You won!/ });
    await expect(won).toBeVisible({ timeout: 15_000 });
    await expect(g.getByRole('dialog', { name: /Resigned/ })).toBeVisible({ timeout: 15_000 });
    await expectScore(h, '1 – 0');

    // Rematch from the overlay, accepted on the other side: colors swap (DESIGN 9.7).
    await won.getByRole('button', { name: 'Rematch' }).click();
    const rematch = incoming(g, 'Your opponent wants a rematch');
    await expect(rematch).toBeVisible({ timeout: 15_000 });
    // The asker's overlay stays, its Rematch showing the pending state (DESIGN 9.7).
    await expect(won.getByRole('button', { name: 'Rematch' })).toBeDisabled();
    await expect(won.getByText('Waiting for your opponent', { exact: true })).toBeVisible();
    await rematch.getByRole('button', { name: 'Accept' }).click();
    await expect(h.getByRole('dialog', { name: /You won!/ })).toHaveCount(0, { timeout: 15_000 });
    await expect(g.getByRole('dialog', { name: /Resigned/ })).toHaveCount(0);
    for (const p of [h, g]) await expectPiece(p, 'e2', 'white pawn');
    // The guest plays white now (its board has white at the bottom), the host black.
    await expect(g.getByRole('gridcell').first()).toHaveAccessibleName(/, a8$/);
    await expect(h.getByRole('gridcell').first()).toHaveAccessibleName(/, h1$/);
    await playAndSee(g, h, 'e2e4', 'white pawn');
    await playAndSee(h, g, 'c7c5', 'black pawn');

    // Score from each side's point of view.
    await expectScore(h, '1 – 0');
    await expectScore(g, '0 – 1');

    await host.context.close();
    await guest.context.close();
  });

  test('recovery: the guest loses its storage, starts the same code, and the host allows the rejoin', async ({ browser }) => {
    const code = randomCode();
    const { host, guest } = await manualRoom(browser, code);
    const h = host.page;
    let g = guest.page;

    // Game 1 ends (the host resigns); game 2 starts with swapped colors and gets a few moves.
    await playAndSee(h, g, 'e2e4', 'white pawn');
    await hold(h, toolbar(h).getByRole('button', { name: 'Offer a draw (hold to resign)' }));
    const won = g.getByRole('dialog', { name: /You won!/ });
    await expect(won).toBeVisible({ timeout: 15_000 });
    await won.getByRole('button', { name: 'Rematch' }).click();
    const rematch = incoming(h, 'Your opponent wants a rematch');
    await expect(rematch).toBeVisible({ timeout: 15_000 });
    await rematch.getByRole('button', { name: 'Accept' }).click();
    // Game 2: the guest plays white now, the host black.
    await expect(h.getByRole('gridcell').first()).toHaveAccessibleName(/, h1$/, { timeout: 15_000 });
    await playAndSee(g, h, 'd2d4', 'white pawn');
    await playAndSee(h, g, 'd7d5', 'black pawn');
    await playAndSee(g, h, 'c2c4', 'white pawn');

    // The guest's storage is cleared and the page reloaded (a lost device).
    await g.close();
    g = await guest.context.newPage();
    await g.goto(`./#/?s=${code}`);
    await g.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await g.reload();
    await expect(stage(g)).toHaveAttribute('data-phase', 'start');
    expect(await g.evaluate(() => localStorage.getItem('zhess:rooms'))).toBeNull();

    // The guest starts the same code with ROOM (it has no record now).
    await startRoom(g, code);

    // The host lost its manual channel; a new manual exchange connects the two again.
    await expect(stage(h)).not.toHaveAttribute('data-room-presence', 'connected', { timeout: 30_000 });
    const offer = await hostOffer(h);
    await openInPlace(g, offer);
    const answer = await guestAnswer(g);
    await hostPaste(h, answer);

    // The host's room is locked and the guest has no key: one Allow toast (DESIGN 9.5).
    const rejoin = incoming(h, 'Opponent is rejoining from a new device');
    await expect(rejoin).toBeVisible({ timeout: 30_000 });
    await rejoin.getByRole('button', { name: 'Allow' }).click();
    await expectConnected(h, g);

    // The guest is restored: same position, same color (white in game 2), the score of game 1.
    await expectPiece(g, 'd4', 'white pawn');
    await expectPiece(g, 'd5', 'black pawn');
    await expectPiece(g, 'c4', 'white pawn');
    await expect(g.getByRole('gridcell').first()).toHaveAccessibleName(/, a8$/);
    await expectScore(g, '1 – 0');
    // The game goes on.
    await playAndSee(h, g, 'e7e6', 'black pawn');

    // And the earlier finished game is in its history.
    await g.getByRole('button', { name: 'Back to start' }).click();
    await expect(stage(g)).toHaveAttribute('data-phase', 'start');
    await g.mouse.move(10, 10);
    await g.mouse.wheel(0, 900);
    await expect(g.getByRole('heading', { name: 'Previous games' })).toBeVisible();
    const cards = g.getByTestId('history-card').filter({ hasText: code });
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Game 1' })).toContainText('Won');
    await expect(cards.filter({ hasText: 'Game 2' })).toContainText('Your move');

    await host.context.close();
    await guest.context.close();
  });

  test('offline move: the guest is away, the host moves, the move arrives when the guest is back', async ({ browser }) => {
    const code = randomCode();
    const { host, guest } = await manualRoom(browser, code);
    const h = host.page;
    let g = guest.page;
    // Untimed room: the strips show time used, not a clock.
    await expect(h.locator('[data-color="w"] [role="timer"]').first()).toHaveAttribute('aria-label', /time used/);

    // The guest closes the app.
    await g.close();
    await expect(stage(h)).not.toHaveAttribute('data-room-presence', 'connected', { timeout: 30_000 });

    // The host moves while the opponent is away (DESIGN 9.6): stored and shown normally.
    await tapMove(h, 'e2e4');
    await expectPiece(h, 'e4', 'white pawn');
    await expect(stage(h)).toHaveAttribute('data-phase', 'playing');

    // The guest comes back to the room: the stored game does not have the move yet.
    g = await guest.context.newPage();
    await g.goto(`./#/?s=${code}&p=1&o=r`);
    await expect(stage(g)).toHaveAttribute('data-phase', 'playing');
    await expectPiece(g, 'e2', 'white pawn');

    // On reconnect the move arrives.
    const offer = await hostOffer(h);
    await openInPlace(g, offer);
    const answer = await guestAnswer(g);
    await hostPaste(h, answer);
    await expectConnected(h, g);
    await expectPiece(g, 'e4', 'white pawn');
    await expectEmpty(g, 'e2');
    await playAndSee(g, h, 'c7c5', 'black pawn');

    await host.context.close();
    await guest.context.close();
  });

  test('BroadcastChannel hand-over: the answer link opened in a second tab connects the waiting tab', async ({ browser }) => {
    const code = randomCode();
    const host = await device(browser, { broker: false });
    const guest = await device(browser, { broker: false });
    await startRoom(host.page, code, 'w');
    await expect(stage(host.page)).toHaveAttribute('data-room-cause', 'broker-unreachable', { timeout: 20_000 });
    const offer = await hostOffer(host.page);
    await guest.page.goto(offer);
    const answer = await guestAnswer(guest.page);

    // The host opens the answer link on its own device: a new tab of the same context.
    const tab = await host.context.newPage();
    await tab.goto(answer);
    const sheet = tab.getByTestId('manual-sheet');
    await expect(sheet.getByText('Done. Go back to the tab with your game.')).toBeVisible({ timeout: 15_000 });
    // The passing tab stays passive: it never connects itself.
    await expect(stage(tab)).toHaveAttribute('data-room-tab', 'handover');

    await expectConnected(host.page, guest.page);
    await playAndSee(host.page, guest.page, 'd2d4', 'white pawn');

    await host.context.close();
    await guest.context.close();
  });

  test('broker path (best effort): the same join through the public PeerJS broker', async ({ browser }) => {
    const code = randomCode();
    const host = await device(browser, { broker: true });
    const guest = await device(browser, { broker: true });
    const h = host.page;
    const g = guest.page;
    await startRoom(h, code, 'w');
    // The invite link: `?s=CODE&o=r` opens the room at once (DESIGN 4.1).
    const inviteLink = await linkIn(h.getByTestId('invite-sheet'));
    expect(new URL(inviteLink).hash).toBe(`#/?s=${code}&o=r`);
    await g.goto(inviteLink);

    // Either both devices connect through the broker, or the app says the broker is unreachable.
    const brokerDown = async (p: Page) =>
      (await stage(p).getAttribute('data-room-cause')) === 'broker-unreachable' ||
      (await stage(p).getAttribute('data-room-failure')) === 'broker-unreachable';
    const outcome = async () => {
      const connected =
        (await stage(h).getAttribute('data-room-presence')) === 'connected' &&
        (await stage(g).getAttribute('data-room-presence')) === 'connected';
      if (connected) return 'connected';
      if ((await brokerDown(h)) || (await brokerDown(g))) return 'broker-unreachable';
      return 'pending';
    };
    await expect.poll(outcome, { timeout: 60_000, intervals: [500] }).not.toBe('pending');
    const result = await outcome();
    test.skip(
      result === 'broker-unreachable',
      'Not verified: the public PeerJS broker (0.peerjs.com) is unreachable or rate-limited from this machine (app failure class broker-unreachable).',
    );

    await expect(stage(h)).toHaveAttribute('data-room-via', 'broker');
    await expect(stage(g)).toHaveAttribute('data-room-via', 'broker');
    await playAndSee(h, g, 'e2e4', 'white pawn');
    await playAndSee(g, h, 'e7e5', 'black pawn');
    await expectScore(h, '0 – 0');

    await host.context.close();
    await guest.context.close();
  });
});
