import { describe, expect, it } from "vitest";
import { parseClaudeFooter } from "./claudeFooter";
import { contextTone, formatCount, sessionFacts } from "./sessionFacts";
import type { SessionInfo } from "./sessionInfo";

const INFO: SessionInfo = {
  model: "Sonnet 4.5",
  modelId: "claude-sonnet-4-5",
  contextUsed: 40_000,
  contextWindow: 200_000,
  contextPercent: 20,
  outputTokens: 1_000,
  startedAt: 0,
  lastAt: 60_000,
  added: 12,
  removed: 3,
};

const FOOTER = parseClaudeFooter(
  [
    "────────────────────",
    "❯ ",
    "────────────────────",
    "  Meesho 🛠️ Opus 5.5 | 📁 Notes | 🧠 [█████░░░░░] 57% | 💰 $117.28 | +9973/-371 | ⏱️ 193h43m | 🌿 main",
    "  ⏵⏵ accept edits on (shift+tab to cycle)",
    "",
    "  ⏺ main",
  ].join("\n"),
);

describe("sessionFacts", () => {
  it("prefers the footer's values and keeps unknown segments without emoji", () => {
    const f = sessionFacts(FOOTER, INFO, "1m", "fallback");
    expect(f).toMatchObject({
      mode: "acceptEdits",
      model: "Opus 5.5",
      folder: "Notes",
      contextPercent: 57,
      cost: "$117.28",
      added: 9973,
      removed: 371,
      duration: "8d 1h",
      extras: ["main"],
      fromFooter: true,
    });
    expect(f.agents).toHaveLength(1);
  });

  it("falls back to the transcript when the footer isn't visible", () => {
    expect(sessionFacts(null, INFO, "1m", "repo")).toMatchObject({
      mode: null,
      model: "Sonnet 4.5",
      folder: "repo",
      contextPercent: 20,
      cost: null,
      added: 12,
      removed: 3,
      duration: "1m",
      extras: [],
      agents: [],
      fromFooter: false,
    });
  });

  it("leaves changes empty when nothing was edited", () => {
    const f = sessionFacts(null, { ...INFO, added: 0, removed: 0 }, null, null);
    expect(f.added).toBeNull();
    expect(f.removed).toBeNull();
  });
});

describe("formatting", () => {
  it("groups thousands and grades the context meter", () => {
    expect(formatCount(9973)).toBe("9,973");
    expect([contextTone(57), contextTone(70), contextTone(90)]).toEqual([
      "ok",
      "warn",
      "high",
    ]);
  });
});

describe("account and duplicate segments", () => {
  it("shows the account once and never repeats the model as an extra", () => {
    const footer = parseClaudeFooter(
      [
        "╭──────╮",
        "│ > hi │",
        "╰──────╯",
        "  Meesho 🛠️ Opus 5.5 | Opus 5.5 fast | 📁 Notes",
        "  ⏵⏵ auto mode on (shift+tab to cycle)",
      ].join("\n"),
    );
    const f = sessionFacts(footer, INFO, null, null);
    expect(f.account).toBe("Meesho");
    expect(f.model).toBe("Opus 5.5");
    expect(f.extras).toEqual([]);
  });
});
