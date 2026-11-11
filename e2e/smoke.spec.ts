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
