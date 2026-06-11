/**
 * Golden flow: tab lifecycle.
 *
 * Opening a new terminal tab and closing it exercises the workspace/tab
 * reducer, the PTY spawn path (a new shell is created), and the never-unmount
 * invariant for background terminals. No AI or secrets required.
 */
import { browser, expect } from "@wdio/globals";

async function tabCount() {
  return (await browser.$$('[role="tab"]')).length;
}

describe("tab lifecycle", () => {
  it("opens a new terminal tab from the new-tab menu", async () => {
    const before = await tabCount();

    const newTab = await browser.$('[data-testid="new-tab-button"]');
    await newTab.waitForClickable({ timeout: 15000 });
    await newTab.click();

    const terminalItem = await browser.$('[data-testid="new-tab-terminal"]');
    await terminalItem.waitForClickable({ timeout: 15000 });
    await terminalItem.click();

    await browser.waitUntil(async () => (await tabCount()) === before + 1, {
      timeout: 15000,
      timeoutMsg: "tab count did not increase after opening a terminal tab",
    });
  });

  it("closes a tab and returns to the previous count", async () => {
    const before = await tabCount();
    expect(before).toBeGreaterThan(1);

    // The active tab's close control is labelled "Close <label> tab".
    const closeButtons = await browser.$$('[aria-label^="Close "]');
    expect(closeButtons.length).toBeGreaterThan(0);
    await closeButtons[closeButtons.length - 1].click();

    await browser.waitUntil(async () => (await tabCount()) === before - 1, {
      timeout: 15000,
      timeoutMsg: "tab count did not decrease after closing a tab",
    });
  });
});
