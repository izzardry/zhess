import { test, expect } from "@playwright/test";

test("start page shows the wordmark and tagline", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("./");

  await expect(page.getByRole("heading", { name: "ZHESS" })).toBeVisible();
  await expect(page.getByText("Zero Distractions. Just Chess.")).toBeVisible();
  await expect(page).toHaveTitle("Zhess - Zero Distractions. Just Chess.");
  expect(errors).toEqual([]);
});

test("engine files are served next to each other", async ({ request }) => {
  const js = await request.get("engine/stockfish-19-lite-single.js");
  expect(js.ok()).toBe(true);
  const wasm = await request.get("engine/stockfish-19-lite-single.wasm");
  expect(wasm.ok()).toBe(true);
  expect(wasm.headers()["content-type"]).toContain("application/wasm");
});

test("unknown routes show the not-found page", async ({ page }) => {
  await page.goto("./#/no-such-page");
  await expect(page.getByText("404")).toBeVisible();
});

test("theme follows the system color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("./");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
});

test("the brand font is self-hosted and loaded", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "ZHESS" })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    // fonts.check() alone is true for undeclared families, so look for a loaded face.
    return [...document.fonts].some(
      (f) => f.family.replace(/"/g, "") === "Fira Code" && f.weight === "300" && f.status === "loaded",
    );
  });
  expect(loaded).toBe(true);
});

test("reload: a dark page from the first paint, then one fade-in with fonts and layout already final", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  await context.addInitScript(() => {
    const w = window as unknown as { __boot: { firstBg: string | null; revealedAt: number | null; fontAtReveal: boolean | null; shifts: { t: number; v: number }[] } };
    w.__boot = { firstBg: null, revealedAt: null, fontAtReveal: null, shifts: [] };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number })[]) w.__boot.shifts.push({ t: e.startTime, v: e.value });
    }).observe({ type: "layout-shift", buffered: true });
    // documentElement does not exist yet when an init script runs; look it up on every mutation.
    const check = () => {
      const html = document.documentElement;
      if (!html) return;
      if (w.__boot.firstBg === null && document.head?.querySelector("style")) w.__boot.firstBg = getComputedStyle(html).backgroundColor;
      if (w.__boot.revealedAt === null && html.classList.length && !html.classList.contains("zhess-booting") && document.getElementById("root")?.childElementCount) {
        w.__boot.revealedAt = performance.now();
        w.__boot.fontAtReveal = document.fonts.check('300 1em "Fira Code"') && [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Fira Code" && f.status === "loaded");
      }
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  });
  const page = await context.newPage();
  await page.goto("./");
  await expect(page.getByTestId("engine-status")).toHaveAttribute("data-status", /ready|downloading/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "ZHESS" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __boot: { revealedAt: number | null } }).__boot.revealedAt)).not.toBeNull();
  await page.waitForTimeout(1500); // the status line answer and any late layout land here
  const boot = await page.evaluate(() => (window as unknown as { __boot: { firstBg: string; revealedAt: number; fontAtReveal: boolean; shifts: { t: number; v: number }[] } }).__boot);
  // The page colour was dark before any app CSS or script ran.
  expect(boot.firstBg).toBe("rgb(13, 13, 13)");
  // The brand font was in place when the page became visible.
  expect(boot.fontAtReveal).toBe(true);
  // Nothing moved after the reveal (the status line keeps its place while the cache is checked).
  const after = boot.shifts.filter((s) => s.t >= boot.revealedAt).reduce((a, s) => a + s.v, 0);
  expect(after).toBe(0);
  // The root fades in over 300 ms.
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("root")!).transitionDuration)).toBe("0.3s");
  await context.close();
});
