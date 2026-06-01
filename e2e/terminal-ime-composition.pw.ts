import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __simulateXtermComposition: () => void;
    __xtermImeMetrics: () => {
      shellClientWidth: number;
      shellScrollWidth: number;
      hostClientWidth: number;
      hostScrollWidth: number;
      helpersClientWidth: number;
      helpersClientHeight: number;
      helpersScrollWidth: number;
      viewWidth: number;
      viewHeight: number;
      textareaWidth: number;
      viewWhiteSpace: string;
      viewOverflowWrap: string;
      viewWordBreak: string;
      textareaWhiteSpace: string;
    };
  }
}

test.describe("terminal IME composition layout", () => {
  test("keeps xterm pinyin composition inside the terminal viewport", async ({ page }) => {
    await page.goto("/e2e/fixtures/terminal-ime-composition.html");

    await page.evaluate(() => window.__simulateXtermComposition());
    const metrics = await page.evaluate(() => window.__xtermImeMetrics());

    expect(metrics.helpersClientWidth).toBe(metrics.hostClientWidth);
    expect(metrics.helpersClientHeight).toBeGreaterThanOrEqual(180);
    expect(metrics.shellScrollWidth).toBeLessThanOrEqual(metrics.shellClientWidth + 1);
    expect(metrics.hostScrollWidth).toBeLessThanOrEqual(metrics.hostClientWidth + 1);
    expect(metrics.viewWhiteSpace).toBe("nowrap");
    expect(metrics.textareaWhiteSpace).toBe("nowrap");
  });
});
