/**
 * Golden flow: the new-file dialog opens and cancels cleanly.
 *
 * Bound to Mod+E via the same window-level capture-phase shortcut path as the
 * command palette. We open the dialog, confirm its input renders, type a name,
 * and cancel with Escape (no file is written, so the run leaves no artifacts).
 * No AI provider, secrets, or network required.
 *
 * e2e runs on Linux/Windows only; the platform modifier is Control.
 */
import { browser, expect } from "@wdio/globals";

const NAME_INPUT = 'input[placeholder="example.ts"]';

describe("new-file dialog", () => {
  it("opens with Ctrl+E", async () => {
    const pane = await browser.$('[data-testid="terminal-pane"]');
    await pane.waitForExist({ timeout: 30000 });

    await browser.keys(["Control", "e"]);

    const input = await browser.$(NAME_INPUT);
    await input.waitForExist({ timeout: 15000 });
    await expect(input).toBeDisplayed();
  });

  it("accepts a filename and cancels on Escape without creating a file", async () => {
    const input = await browser.$(NAME_INPUT);
    await input.setValue("scratch-e2e.ts");
    await expect(input).toHaveValue("scratch-e2e.ts");

    await browser.keys(["Escape"]);

    await browser.$(NAME_INPUT).waitForExist({ timeout: 15000, reverse: true });
  });
});
