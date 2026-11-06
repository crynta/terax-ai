import { describe, expect, it, vi } from "vitest";
import { GhosttySemanticEventRouter } from "./GhosttySemanticEventRouter";

describe("GhosttySemanticEventRouter", () => {
  it("routes cwd only outside untrusted command output", () => {
    const onCwd = vi.fn();
    const router = new GhosttySemanticEventRouter({ onCwd });

    router.handle({ type: "pwd", uri: "file://localhost/Users/terax" });
    router.handle({ type: "prompt-end" });
    router.handle({ type: "pwd", uri: "file://attacker/tmp/ignored" });
    router.handle({ type: "end-of-command", exitCode: 0 });
    router.handle({ type: "pwd", uri: "file://localhost/Users/terax/src" });

    expect(onCwd).toHaveBeenCalledTimes(2);
    expect(onCwd).toHaveBeenNthCalledWith(1, "/Users/terax");
    expect(onCwd).toHaveBeenNthCalledWith(2, "/Users/terax/src");
  });

  it("tracks command execution separately from prompt input", () => {
    const onCommandState = vi.fn();
    const router = new GhosttySemanticEventRouter({ onCommandState });

    router.handle({ type: "prompt-start" });
    router.handle({ type: "prompt-end" });
    router.handle({ type: "end-of-input" });
    router.handle({ type: "end-of-command", exitCode: 7 });

    expect(onCommandState.mock.calls).toEqual([[false], [true], [false]]);
  });

  it("validates and decodes OSC 52 clipboard writes", () => {
    const onClipboard = vi.fn();
    const router = new GhosttySemanticEventRouter({ onClipboard });

    router.handle({
      type: "clipboard",
      selection: "c",
      data: btoa("hello"),
    });
    router.handle({
      type: "clipboard",
      selection: "p",
      data: btoa("ignored"),
    });

    expect(onClipboard).toHaveBeenCalledOnce();
    expect(onClipboard).toHaveBeenCalledWith("hello");
  });

  it("treats a new prompt as the end of a command that never reported one", () => {
    const states: boolean[] = [];
    const onCwd = vi.fn();
    const router = new GhosttySemanticEventRouter({
      onCommandState: (running) => states.push(running),
      onCwd,
    });
    // exec zsh: C, then the replacement shell's first prompt, no D.
    router.handle({ type: "end-of-input" });
    router.handle({ type: "pwd", uri: "file:///ignored" });
    router.handle({ type: "prompt-start" });
    router.handle({ type: "pwd", uri: "file:///home/me" });
    expect(states).toEqual([true, false]);
    expect(onCwd.mock.calls).toEqual([["/home/me"]]);
  });

  it("says whether a prompt's shell can report that a command started", () => {
    const onPromptEnd = vi.fn();
    const router = new GhosttySemanticEventRouter({ onPromptEnd });
    router.handle({ type: "prompt-end" });
    // Bash before 4.4 marks its prompts with terax_blocks=0 and has no PS0.
    router.handle({ type: "prompt-end", blockInput: false });
    expect(onPromptEnd.mock.calls).toEqual([[true], [false]]);
  });

  it("reports bounded-queue overflow", () => {
    const onOverflow = vi.fn();
    const router = new GhosttySemanticEventRouter({ onOverflow });
    router.handle({ type: "overflow", dropped: 3 });
    expect(onOverflow).toHaveBeenCalledWith(3);
  });
});
