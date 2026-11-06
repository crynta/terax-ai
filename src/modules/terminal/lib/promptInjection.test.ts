import { describe, expect, it } from "vitest";

import {
  type InjectionTarget,
  type ShellInputState,
  shellAcceptsInjectedCommand,
  writeAtShellPrompt,
} from "./promptInjection";

const idle: ShellInputState = {
  integrated: true,
  commandRunning: false,
  commandTracked: true,
  alternateScreen: false,
  agentActive: false,
};

describe("shellAcceptsInjectedCommand", () => {
  it("accepts a command at an integrated prompt", async () => {
    expect(await shellAcceptsInjectedCommand(idle)).toBe(true);
  });

  it("refuses while a command owns the foreground", async () => {
    expect(
      await shellAcceptsInjectedCommand({ ...idle, commandRunning: true }),
    ).toBe(false);
  });

  it("refuses full-screen programs and coding agents whatever the shell reported", async () => {
    expect(
      await shellAcceptsInjectedCommand({ ...idle, alternateScreen: true }),
    ).toBe(false);
    expect(
      await shellAcceptsInjectedCommand({ ...idle, agentActive: true }),
    ).toBe(false);
    expect(
      await shellAcceptsInjectedCommand({
        ...idle,
        integrated: false,
        alternateScreen: true,
      }),
    ).toBe(false);
  });

  it("rejects unintegrated shells even without a foreground child", () => {
    expect(shellAcceptsInjectedCommand({ ...idle, integrated: false })).toBe(
      false,
    );
  });

  it("rejects legacy shells whose builtins can consume stdin without a command-start marker", () => {
    expect(
      shellAcceptsInjectedCommand({ ...idle, commandTracked: false }),
    ).toBe(false);
  });
});

describe("writeAtShellPrompt", () => {
  function session(
    overrides: Partial<{
      -readonly [K in keyof InjectionTarget]: InjectionTarget[K];
    }> = {},
  ) {
    const written: string[] = [];
    const target = {
      shellExited: false,
      disposed: false,
      promptIntegrated: true,
      commandRunning: false,
      commandTracked: true,
      model: { modes: () => ({ alternateScreen: false }) },
      pty: { id: 7 },
      writer: {
        enqueue: (bytes: Uint8Array) => {
          written.push(new TextDecoder().decode(bytes));
          return true;
        },
      },
      ...overrides,
    };
    return { target, written };
  }

  it("types the command at an idle prompt", async () => {
    const { target, written } = session();
    expect(await writeAtShellPrompt(target, "cd /tmp\r", () => false)).toBe(
      true,
    );
    expect(written).toEqual(["cd /tmp\r"]);
  });

  it("types nothing while a coding agent owns the terminal", async () => {
    const { target, written } = session();
    expect(await writeAtShellPrompt(target, "cd /tmp\r", () => true)).toBe(
      false,
    );
    expect(written).toEqual([]);
  });

  it("does not type into an untracked builtin such as read", () => {
    const { target, written } = session({ commandTracked: false });
    expect(writeAtShellPrompt(target, "cd /tmp\r", () => false)).toBe(false);
    expect(written).toEqual([]);
  });

  it("does not type into an unintegrated shell", () => {
    const { target, written } = session({ promptIntegrated: false });
    expect(writeAtShellPrompt(target, "cd /tmp\r", () => false)).toBe(false);
    expect(written).toEqual([]);
  });

  it("types nothing once the shell exited or the pane closed", () => {
    for (const overrides of [
      { shellExited: true },
      { disposed: true },
      { pty: null },
      { model: null },
    ]) {
      const { target, written } = session(overrides);
      expect(writeAtShellPrompt(target, "cd /tmp\r", () => false)).toBe(false);
      expect(written).toEqual([]);
    }
  });

  it("reads current command, screen and agent state and writes without yielding", () => {
    const { target, written } = session();
    target.commandRunning = true;
    expect(writeAtShellPrompt(target, "cd /tmp\r", () => false)).toBe(false);
    target.commandRunning = false;
    target.model = { modes: () => ({ alternateScreen: true }) };
    expect(writeAtShellPrompt(target, "cd /tmp\r", () => false)).toBe(false);
    target.model = { modes: () => ({ alternateScreen: false }) };
    let active = true;
    const agentActive = () => active;
    expect(writeAtShellPrompt(target, "cd /tmp\r", agentActive)).toBe(false);
    expect(written).toEqual([]);
    active = false;
    expect(writeAtShellPrompt(target, "cd /tmp\r", agentActive)).toBe(true);
    expect(written).toEqual(["cd /tmp\r"]);
  });
});
