/**
 * Golden flow: the AI chat surface, end to end, against the mock provider.
 *
 * This is the Phase C, Stage 0 scaffold: it proves the composer -> transport ->
 * store -> transcript path works without a live BYOK provider. The `terax.e2e`
 * flag swaps in a deterministic offline model (see src/modules/ai/lib/
 * mockProvider.ts) that streams a canned reply, so the run needs no keys and no
 * network. Once this exists, the converged chat surface can be regression
 * tested the same way the terminal/tab flows are.
 *
 * e2e runs on Linux/Windows only; the platform modifier is Control.
 */
import { browser, expect } from "@wdio/globals";

describe("ai chat (mock provider)", () => {
  it("streams a mock assistant reply end to end", async () => {
    // The app must be loaded before localStorage has an origin to write to.
    await browser
      .$('[data-testid="terminal-pane"]')
      .waitForExist({ timeout: 30000 });

    // Enable the deterministic mock provider, then reload so boot selects it
    // as the default model and unlocks the composer (no keys required).
    await browser.execute(() =>
      window.localStorage.setItem("terax.e2e", "1"),
    );
    await browser.refresh();
    await browser
      .$('[data-testid="terminal-pane"]')
      .waitForExist({ timeout: 30000 });

    // Open the AI composer. The shortcut is a window capture-phase listener, so
    // it fires even though the terminal holds focus on boot.
    await browser.keys(["Control", "i"]);

    const input = await browser.$('[data-testid="ai-composer-input"]');
    await input.waitForDisplayed({ timeout: 15000 });
    await input.click();
    await browser.keys("hello from e2e".split(""));
    await browser.keys(["Enter"]);

    // Submitting auto-opens the mini window, where the mock streams its reply.
    const reply = await browser.$("*=Mock reply");
    await reply.waitForExist({ timeout: 20000 });
    await expect(reply).toBeExisting();
  });
});
