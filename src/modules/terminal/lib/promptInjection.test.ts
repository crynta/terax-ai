import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  type InjectionTarget,
  type ShellInputState,
  shellAcceptsInjectedCommand,
  writeAtShellPrompt,
} from "./promptInjection";

afterEach(() => vi.clearAllMocks());

const idle: ShellInputState = {
  integrated: true,
  commandRunning: false,
  commandTracked: true,
  alternateScreen: false,
  agentActive: false,
};

const never = () => Promise.reject(new Error("the OS must not be asked"));

describe("shellAcceptsInjectedCommand", () => {
  it("accepts a command at an integrated prompt", async () => {
    expect(await shellAcceptsInjectedCommand(idle, never)).toBe(true);
  });

  it("refuses while a command owns the foreground", async () => {
    expect(
      await shellAcceptsInjectedCommand(
        { ...idle, commandRunning: true },
        never,
      ),
    ).toBe(false);
  });

  it("refuses full-screen programs and coding agents whatever the shell reported", async () => {
    expect(
      await shellAcceptsInjectedCommand(
        { ...idle, alternateScreen: true },
        never,
      ),
    ).toBe(false);
    expect(
      await shellAcceptsInjectedCommand({ ...idle, agentActive: true }, never),
    ).toBe(false);
    expect(
      await shellAcceptsInjectedCommand(
        { ...idle, integrated: false, alternateScreen: true },
        never,
      ),
    ).toBe(false);
  });

  it("trusts a shell that never reported a prompt, like cmd.exe", async () => {
    expect(
      await shellAcceptsInjectedCommand(
        { ...idle, integrated: false, commandRunning: true },
        never,
      ),
    ).toBe(true);
  });

  it("asks the operating system when the shell cannot report command starts", async () => {
    // Bash before 4.4: prompts are marked, but a running command is not.
    const old: ShellInputState = { ...idle, commandTracked: false };
    const busy = vi.fn(async () => true);
    expect(await shellAcceptsInjectedCommand(old, busy)).toBe(false);
    expect(busy).toHaveBeenCalledOnce();
    expect(await shellAcceptsInjectedCommand(old, async () => false)).toBe(
      true,
    );
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
    expect(await writeAtShellPrompt(target, "cd /tmp\r", false)).toBe(true);
    expect(written).toEqual(["cd /tmp\r"]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("types nothing while a coding agent owns the terminal", async () => {
    const { target, written } = session();
    expect(await writeAtShellPrompt(target, "cd /tmp\r", true)).toBe(false);
    expect(written).toEqual([]);
  });

  it("asks the operating system when the shell cannot report command starts", async () => {
    const { target, written } = session({ commandTracked: false });
    mocks.invoke.mockResolvedValueOnce(true);
    expect(await writeAtShellPrompt(target, "cd /tmp\r", false)).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith("pty_has_foreground_job", {
      id: 7,
    });
    mocks.invoke.mockResolvedValueOnce(false);
    expect(await writeAtShellPrompt(target, "cd /tmp\r", false)).toBe(true);
    expect(written).toEqual(["cd /tmp\r"]);
  });

  it("types nothing once the shell exited or the pane closed while it waited", async () => {
    const exited = session({ commandTracked: false });
    mocks.invoke.mockImplementationOnce(async () => {
      (exited.target as { shellExited: boolean }).shellExited = true;
      return false;
    });
    expect(await writeAtShellPrompt(exited.target, "cd /tmp\r", false)).toBe(
      false,
    );
    const closed = session({ commandTracked: false });
    mocks.invoke.mockImplementationOnce(async () => {
      (closed.target as { disposed: boolean }).disposed = true;
      return false;
    });
    expect(await writeAtShellPrompt(closed.target, "cd /tmp\r", false)).toBe(
      false,
    );
    expect(exited.written).toEqual([]);
    expect(closed.written).toEqual([]);
  });
});
