/**
 * Golden flow: the terminal accepts input.
 *
 * xterm renders its grid to a WebGL canvas, so the on-screen text is not
 * readable through the DOM. What we CAN assert structurally: a live PTY-backed
 * terminal mounts, exposes the xterm helper textarea that receives keystrokes,
 * and the app stays responsive after sending a command. This smoke-tests the
 * PTY spawn + input plumbing without depending on shell-integration OSC codes.
 */
import { browser, expect } from "@wdio/globals";

describe("terminal input", () => {
  it("mounts an xterm instance with an input target", async () => {
    const pane = await browser.$('[data-testid="terminal-pane"]');
    await pane.waitForExist({ timeout: 30000 });

    // xterm injects a hidden textarea that owns keyboard focus.
    const helper = await browser.$(".xterm-helper-textarea");
    await helper.waitForExist({ timeout: 30000 });
    await expect(helper).toBeExisting();
  });

  it("accepts a typed command and stays responsive", async () => {
    const pane = await browser.$('[data-testid="terminal-pane"]');
    await pane.click();

    // Type an inert command and submit it. We are not asserting the rendered
    // output (canvas), only that input does not wedge the UI.
    await browser.keys([..."printf hello".split(""), "Enter"]);

    // The shell remains usable: tab bar and breadcrumb are still mounted.
    const tabBar = await browser.$('[data-testid="tab-bar"]');
    await expect(tabBar).toBeExisting();

    const breadcrumb = await browser.$('[data-testid="cwd-breadcrumb"]');
    await expect(breadcrumb).toBeExisting();
  });
});
