import { describe, expect, it } from "vitest";
import {
  parseActivityLine,
  parseClaudeActivity,
  sameActivity,
} from "./claudeActivity";

describe("parseActivityLine", () => {
  it("reads a working spinner with elapsed, tokens and the interrupt hint", () => {
    expect(
      parseActivityLine(
        "✽ Cogitating… (12s · ↓ 3.1k tokens · esc to interrupt)",
      ),
    ).toEqual({
      verb: "Cogitating…",
      detail: null,
      elapsed: "12s",
      tokens: "3.1k",
      direction: "down",
      waitingFor: null,
      done: false,
      doneAt: null,
      interruptible: true,
    });
    expect(
      parseActivityLine("· Brewing… (2m 10s · ↑ 1.2k tokens)"),
    ).toMatchObject({
      verb: "Brewing…",
      elapsed: "2m 10s",
      tokens: "1.2k",
      direction: "up",
      interruptible: false,
    });
    expect(parseActivityLine("✻ Thinking…")).toMatchObject({
      verb: "Thinking…",
      elapsed: null,
      tokens: null,
    });
  });

  it("reads background-agent waits", () => {
    expect(
      parseActivityLine("✻ Waiting for 1 background agent to finish"),
    ).toMatchObject({
      verb: "Waiting",
      waitingFor: 1,
      detail: "Waiting for 1 background agent",
    });
    expect(
      parseActivityLine("* Waiting for 2 background agents to finish"),
    ).toMatchObject({
      waitingFor: 2,
      detail: "Waiting for 2 background agents",
    });
  });

  it("reads finished lines with or without the done time", () => {
    expect(
      parseActivityLine("✻ Cooked for 14m 37s · done 11:45 PM"),
    ).toMatchObject({
      verb: "Cooked",
      done: true,
      elapsed: "14m 37s",
      doneAt: "11:45 PM",
      detail: "Finished in 14m 37s",
    });
    expect(parseActivityLine("✻ Churned for 43s")).toMatchObject({
      done: true,
      elapsed: "43s",
      doneAt: null,
    });
  });

  it("ignores ordinary lines", () => {
    expect(parseActivityLine("⏺ I'll check the tree.")).toBeNull();
    expect(parseActivityLine("· a bullet in output")).toBeNull();
    expect(parseActivityLine("plain text")).toBeNull();
  });
});

describe("parseClaudeActivity", () => {
  it("finds the spinner just above the input box", () => {
    const screen = [
      "⏺ Running the build.",
      "",
      "✶ Compiling… (1m 5s · ↓ 22k tokens · esc to interrupt)",
      "",
      "─────────────────────────────── notes ─",
      "❯ ",
      "────────────────────────────────────────",
      "  Opus 5.5 | 📁 Notes",
      "  ⏵⏵ auto mode on (shift+tab to cycle)",
    ].join("\n");
    expect(parseClaudeActivity(screen)).toMatchObject({
      verb: "Compiling…",
      elapsed: "1m 5s",
      tokens: "22k",
    });
  });

  it("returns null without an activity line", () => {
    expect(
      parseClaudeActivity(
        ["⏺ Done.", "──────────", "❯ ", "──────────"].join("\n"),
      ),
    ).toBeNull();
  });

  it("compares every field", () => {
    const a = parseActivityLine("✽ Cogitating… (12s · ↓ 3.1k tokens)");
    expect(
      sameActivity(a, parseActivityLine("✽ Cogitating… (12s · ↓ 3.1k tokens)")),
    ).toBe(true);
    expect(
      sameActivity(a, parseActivityLine("✽ Cogitating… (13s · ↓ 3.1k tokens)")),
    ).toBe(false);
  });
});
