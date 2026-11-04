import { describe, expect, it } from "vitest";
import {
  type ShellInputState,
  shellAcceptsInjectedCommand,
} from "./promptInjection";

const idle: ShellInputState = {
  integrated: true,
  commandRunning: false,
  alternateScreen: false,
  agentActive: false,
};

describe("shellAcceptsInjectedCommand", () => {
  it("accepts a command at an integrated prompt", () => {
    expect(shellAcceptsInjectedCommand(idle)).toBe(true);
  });

  it("refuses while a command owns the foreground", () => {
    expect(shellAcceptsInjectedCommand({ ...idle, commandRunning: true })).toBe(
      false,
    );
  });

  it("refuses full-screen programs and coding agents whatever the shell reported", () => {
    expect(shellAcceptsInjectedCommand({ ...idle, alternateScreen: true })).toBe(
      false,
    );
    expect(shellAcceptsInjectedCommand({ ...idle, agentActive: true })).toBe(
      false,
    );
    expect(
      shellAcceptsInjectedCommand({
        ...idle,
        integrated: false,
        alternateScreen: true,
      }),
    ).toBe(false);
  });

  it("trusts a shell that never reported a prompt, like cmd.exe", () => {
    expect(
      shellAcceptsInjectedCommand({
        ...idle,
        integrated: false,
        commandRunning: true,
      }),
    ).toBe(true);
  });
});
