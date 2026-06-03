import { describe, expect, it } from "vitest";
import { SshCommandTracker } from "./sshCommandTracker";

describe("SshCommandTracker", () => {
  it("detects a plain ssh command", () => {
    const tracker = new SshCommandTracker();
    expect(tracker.feed("ssh sean@100.72.187.38\r")).toEqual({
      user: "sean",
      host: "100.72.187.38",
      port: null,
      rawTarget: "sean@100.72.187.38",
    });
  });

  it("skips common ssh options before the target", () => {
    const tracker = new SshCommandTracker();
    expect(tracker.feed("ssh -p 2222 -o StrictHostKeyChecking=accept-new sean@host\r")).toEqual({
      user: "sean",
      host: "host",
      port: 2222,
      rawTarget: "sean@host",
    });
  });

  it("supports backspace edits before enter", () => {
    const tracker = new SshCommandTracker();
    expect(tracker.feed("ssh seann\x7f@host\r")).toEqual({
      user: "sean",
      host: "host",
      port: null,
      rawTarget: "sean@host",
    });
  });

  it("ignores non-ssh commands", () => {
    const tracker = new SshCommandTracker();
    expect(tracker.feed("git status\r")).toBeNull();
  });
});

