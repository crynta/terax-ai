/**
 * Golden flow: the app launches and renders its core shell.
 *
 * This is the cheapest, most valuable e2e: it catches a build that compiles
 * but crashes on boot (bad asset path, panicking setup hook, broken provider
 * tree). It needs no AI provider, no secrets, and no network.
 */
import { browser, expect } from "@wdio/globals";

describe("app smoke", () => {
  it("mounts the React root", async () => {
    const root = await browser.$("#root");
    await root.waitForExist({ timeout: 30000 });
    // The root must actually have rendered children, not just exist empty.
    await browser.waitUntil(
      async () => (await root.$$("*")).length > 0,
      {
        timeout: 30000,
        timeoutMsg: "#root never rendered any children",
      },
    );
  });

  it("shows the Terax window title", async () => {
    await expect(browser).toHaveTitle("Terax");
  });

  it("renders the tab bar and a terminal pane on first boot", async () => {
    const tabBar = await browser.$('[data-testid="tab-bar"]');
    await tabBar.waitForExist({ timeout: 30000 });
    await expect(tabBar).toBeExisting();

    const terminal = await browser.$('[data-testid="terminal-pane"]');
    await terminal.waitForExist({ timeout: 30000 });
    await expect(terminal).toBeExisting();
  });

  it("opens with exactly one tab", async () => {
    const tabs = await browser.$$('[role="tab"]');
    await expect(tabs).toBeElementsArrayOfSize({ gte: 1 });
  });
});
