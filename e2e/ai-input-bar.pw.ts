import { expect, test } from "@playwright/test";

test.describe("AI input IME layout", () => {
  test("keeps the composer textarea shrinkable inside its flex row", async ({ page }) => {
    await page.goto("/e2e/fixtures/ai-input-bar.html");

    const textarea = page.getByTestId("composer-textarea");
    await expect(textarea).toHaveCSS("min-width", "0px");
  });

  test("does not widen the composer row for long composition text", async ({ page }) => {
    await page.goto("/e2e/fixtures/ai-input-bar.html");

    const shell = page.getByTestId("shell");
    const row = page.getByTestId("composer-row");
    const textarea = page.getByTestId("composer-textarea");
    const before = await shell.boundingBox();
    expect(before).not.toBeNull();

    await textarea.fill("zhong wen hou xuan ci ".repeat(20));

    const afterShell = await shell.boundingBox();
    const afterRow = await row.boundingBox();
    expect(afterShell).not.toBeNull();
    expect(afterRow).not.toBeNull();
    expect(afterShell!.width).toBeCloseTo(before!.width, 0);
    expect(afterRow!.width).toBeLessThanOrEqual(afterShell!.width);
  });
});
