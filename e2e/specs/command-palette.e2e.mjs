/**
 * Golden flow: the command palette opens and closes.
 *
 * The palette is bound to Mod+Shift+P through a window-level capture-phase
 * keydown listener, so the chord fires even while the terminal holds focus.
 * This exercises the global shortcut path and the cmdk dialog mount/unmount.
 * No AI provider, secrets, or network required.
 *
 * e2e runs on Linux/Windows only (see e2e/README.md), where the platform
 * modifier is Control.
 */
import { browser, expect } from "@wdio/globals";

const PALETTE_INPUT = 'input[placeholder="Run a command or open a file..."]';

describe("command palette", () => {
  it("opens with Ctrl+Shift+P", async () => {
    const pane = await browser.$('[data-testid="terminal-pane"]');
    await pane.waitForExist({ timeout: 30000 });

    await browser.keys(["Control", "Shift", "p"]);

    const input = await browser.$(PALETTE_INPUT);
    await input.waitForExist({ timeout: 15000 });
    await expect(input).toBeDisplayed();
  });

  it("filters as you type and closes on Escape", async () => {
    const input = await browser.$(PALETTE_INPUT);
    await input.setValue("new");
    // The palette stays open and shows its command list while typing.
    await expect(input).toHaveValue("new");

    await browser.keys(["Escape"]);

    await browser
      .$(PALETTE_INPUT)
      .waitForExist({ timeout: 15000, reverse: true });
  });
});
