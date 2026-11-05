import { describe, expect, it, vi } from "vitest";
import {
  type ShellInputState,
  shellAcceptsInjectedCommand,
} from "./promptInjection";

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
      await shellAcceptsInjectedCommand({ ...idle, commandRunning: true }, never),
    ).toBe(false);
  });

  it("refuses full-screen programs and coding agents whatever the shell reported", async () => {
    expect(
      await shellAcceptsInjectedCommand({ ...idle, alternateScreen: true }, never),
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
    expect(await shellAcceptsInjectedCommand(old, async () => false)).toBe(true);
  });
});
