import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __lastSequence?: { raw: string; hex: string } | null;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/fixtures/terminal-keymap.html");
  await page.getByLabel("terminal input").focus();
});

async function lastHex(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__lastSequence?.hex ?? null);
}

test.describe("terminal editor newline shortcuts", () => {
  for (const combo of ["Shift+Enter", "Control+Enter"] as const) {
    test(`passes ${combo} through as Pi newline input`, async ({ page }) => {
      await page.keyboard.press(combo);

      await expect.poll(() => lastHex(page)).toBe("1b 5b 31 33 3b 32 75");
    });
  }

  test("does not remap Alt+Enter to newline", async ({ page }) => {
    await page.keyboard.press("Alt+Enter");

    await expect.poll(() => lastHex(page)).toBeNull();
  });
});

test.describe("GSD terminal shortcuts", () => {
  for (const [combo, hex] of [
    ["Control+Alt+B", "1b 02"],
    ["Control+Alt+G", "1b 07"],
    ["Control+Alt+N", "1b 0e"],
    ["Control+Alt+P", "1b 10"],
    ["Control+Alt+V", "1b 16"],
  ] as const) {
    test(`passes ${combo} through as PTY input`, async ({ page }) => {
      await page.keyboard.press(combo);

      await expect.poll(() => lastHex(page)).toBe(hex);
    });
  }

  test("passes Ctrl+Alt+] through as PTY input", async ({ page }) => {
    await page.keyboard.down("Control");
    await page.keyboard.down("Alt");
    await page.keyboard.press("]");
    await page.keyboard.up("Alt");
    await page.keyboard.up("Control");

    await expect.poll(() => lastHex(page)).toBe("1b 1d");
  });

  for (const [combo, hex] of [
    ["Control+Shift+G", "1b 5b 31 30 33 3b 36 75"],
    ["Control+Shift+N", "1b 5b 31 31 30 3b 36 75"],
  ] as const) {
    test(`passes ${combo} fallback through as PTY input`, async ({ page }) => {
      await page.keyboard.press(combo);

      await expect.poll(() => lastHex(page)).toBe(hex);
    });
  }
});
