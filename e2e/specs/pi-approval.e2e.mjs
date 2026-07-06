/**
 * Security flow: webview-native Pi tool approvals, end to end.
 *
 * The deterministic Pi faux provider emits a write_file tool call when it sees
 * the sentinel prompts below. Approving must create the file through the Rust
 * `pi_agent_tool_execute` path; denying must leave the file absent.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { browser, expect } from "@wdio/globals";

const APPROVE_PROMPT = "[terax-e2e-pi-approval-approved] write the fixture";
const DENY_PROMPT = "[terax-e2e-pi-approval-denied] write the fixture";
const APPROVED_RELATIVE_PATH = "e2e/.tmp/pi-approval-approved.txt";
const DENIED_RELATIVE_PATH = "e2e/.tmp/pi-approval-denied.txt";
const APPROVED_CONTENT = "approved through Rust pi_agent_tool_execute\n";
const DENIED_CONTENT = "denied should not be written\n";

const approvedPath = resolve(process.cwd(), APPROVED_RELATIVE_PATH);
const deniedPath = resolve(process.cwd(), DENIED_RELATIVE_PATH);

function resetFixtures() {
  mkdirSync(dirname(approvedPath), { recursive: true });
  rmSync(approvedPath, { force: true });
  rmSync(deniedPath, { force: true });
}

async function enableMockPiRuntime() {
  await browser
    .$('[data-testid="terminal-pane"]')
    .waitForExist({ timeout: 30000 });
  await browser.execute(() => window.localStorage.setItem("terax.e2e", "1"));
  await browser.refresh();
  await browser
    .$('[data-testid="terminal-pane"]')
    .waitForExist({ timeout: 30000 });
}

async function openCodePanel() {
  const codeButton = await browser.$('button[title="Code"]');
  await codeButton.waitForClickable({ timeout: 15000 });
  await codeButton.click();
  await browser
    .$('[aria-label="Code sessions"]')
    .waitForExist({ timeout: 15000 });
}

async function createPiSession() {
  const createButton = await browser.$(
    '//button[normalize-space(.)="New" or normalize-space(.)="Create session"]',
  );
  await createButton.waitForClickable({ timeout: 30000 });
  await createButton.click();

  const prompt = await browser.$('textarea[aria-label="Pi prompt"]');
  await browser.waitUntil(async () => prompt.isEnabled(), {
    timeout: 15000,
    timeoutMsg: "Pi prompt did not become enabled after creating a session",
  });
}

async function sendPiPrompt(text) {
  const prompt = await browser.$('textarea[aria-label="Pi prompt"]');
  await prompt.waitForEnabled({ timeout: 15000 });
  await prompt.setValue(text);
  await browser.keys(["Enter"]);
}

async function respondToLatestApproval(label) {
  await browser.$("*=needs approval").waitForExist({ timeout: 20000 });
  const button = await browser.$(`//button[normalize-space(.)="${label}"]`);
  await button.waitForClickable({ timeout: 15000 });
  await button.click();
}

describe("pi tool approvals (mock provider)", () => {
  before(async () => {
    resetFixtures();
    await enableMockPiRuntime();
    await openCodePanel();
  });

  after(() => {
    resetFixtures();
  });

  it("executes an approved write through the Rust agent-tool path", async () => {
    await createPiSession();
    await sendPiPrompt(APPROVE_PROMPT);
    await respondToLatestApproval("Approve");

    await browser.waitUntil(() => existsSync(approvedPath), {
      timeout: 20000,
      timeoutMsg: "approved Pi write did not create the fixture file",
    });
    expect(readFileSync(approvedPath, "utf8")).toBe(APPROVED_CONTENT);

    const followUp = await browser.$(
      "*=Mock pi tool follow-up: write completed",
    );
    await followUp.waitForExist({ timeout: 20000 });
  });

  it("does not execute a denied write", async () => {
    await createPiSession();
    await sendPiPrompt(DENY_PROMPT);
    await respondToLatestApproval("Deny");

    const followUp = await browser.$("*=Mock pi tool follow-up: write denied");
    await followUp.waitForExist({ timeout: 20000 });

    expect(existsSync(deniedPath)).toBe(false);
    if (existsSync(deniedPath)) {
      expect(readFileSync(deniedPath, "utf8")).not.toBe(DENIED_CONTENT);
    }
  });
});
