import { describe, expect, it } from "vitest";
import {
  footerChip,
  formatFooterDuration,
  parseClaudeFooter,
  sameFooter,
  stripEmoji,
} from "./claudeFooter";

const screen = (...lines: string[]) => lines.join("\n");

const FULL = screen(
  "⏺ Built and ready. Quit Terax to install.",
  "",
  "──────────────────────────────────────── session-reader-workspace-ui ─",
  "❯ check the reader",
  "──────────────────────────────────────────────────────────────────────",
  "  Meesho 🛠️ Opus 5.5 | 📁 Notes | 🧠 [█████░░░░░] 57% | 💰 $117.28 | +9973/-371 | ⏱️ 193h43m",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
  "",
  "  ⏺ main",
  "  ◯ fork  Blocking send during open dialog                    7m 26s · ↓ 615.5k tokens",
);

describe("parseClaudeFooter", () => {
  it("reads the status line, mode and agents under the input box", () => {
    const f = parseClaudeFooter(FULL);
    expect(f?.statusline).toEqual([
      "Meesho 🛠️ Opus 5.5 | 📁 Notes | 🧠 [█████░░░░░] 57% | 💰 $117.28 | +9973/-371 | ⏱️ 193h43m",
    ]);
    expect(f?.mode).toBe("auto");
    expect(f?.chips.map((c) => c.kind)).toEqual([
      "model",
      "folder",
      "context",
      "cost",
      "lines",
      "duration",
    ]);
    expect(f?.agents).toEqual([
      { name: "main", title: null, elapsed: null, tokens: null, active: true },
      {
        name: "fork",
        title: "Blocking send during open dialog",
        elapsed: "7m 26s",
        tokens: "615.5k",
        active: false,
      },
    ]);
  });

  it("maps every permission mode and defaults when none is shown", () => {
    const withMode = (line: string) =>
      parseClaudeFooter(
        screen("────────────", "❯ ", "────────────", "  Opus 5.5 | 📁 x", line),
      )?.mode;
    expect(withMode("  ⏵⏵ accept edits on (shift+tab to cycle)")).toBe(
      "acceptEdits",
    );
    expect(withMode("  ⏸ plan mode on (shift+tab to cycle)")).toBe("plan");
    expect(withMode("  ⏵⏵ bypass permissions on")).toBe("bypass");
    expect(withMode("  ? for shortcuts")).toBe("default");
  });

  it("falls back to the mode line when a dialog hides the input box", () => {
    const f = parseClaudeFooter(
      screen(
        "Do you want to proceed?",
        "❯ 1. Yes",
        "  2. No",
        "  Opus 5.5 | 📁 Notes | 🧠 [██░░] 20%",
        "  ⏸ plan mode on (shift+tab to cycle)",
      ),
    );
    expect(f?.mode).toBe("plan");
    expect(f?.statusline).toEqual(["Opus 5.5 | 📁 Notes | 🧠 [██░░] 20%"]);
  });

  it("lists background tasks", () => {
    const f = parseClaudeFooter(
      screen(
        "──────────",
        "❯ ",
        "──────────",
        "  ⏵⏵ auto mode on",
        "  2 background tasks",
      ),
    );
    expect(f?.agents[0]).toMatchObject({
      name: "background",
      title: "2 background tasks",
    });
  });

  it("returns null with no footer on screen", () => {
    expect(parseClaudeFooter(screen("$ ls", "a b c"))).toBeNull();
    expect(parseClaudeFooter("")).toBeNull();
  });
});

describe("footerChip", () => {
  it("recognises segments by emoji or shape and parses their values", () => {
    expect(footerChip("🧠 [█████░░░░░] 57%")).toEqual({
      kind: "context",
      text: "57%",
      percent: 57,
    });
    expect(footerChip("💰 $117.28")).toEqual({
      kind: "cost",
      text: "$117.28",
      cost: "$117.28",
    });
    expect(footerChip("+9973/-371")).toMatchObject({
      kind: "lines",
      added: 9973,
      removed: 371,
    });
    expect(footerChip("⏱️ 193h43m")).toEqual({
      kind: "duration",
      text: "193h43m",
      duration: "8d 1h",
    });
    expect(footerChip("📁 Notes")).toEqual({
      kind: "folder",
      text: "Notes",
      folder: "Notes",
    });
    expect(footerChip("Meesho 🛠️ Opus 5.5")).toMatchObject({
      kind: "model",
      model: "Opus 5.5",
    });
  });

  it("strips emoji from unknown segments and drops ones with no value", () => {
    expect(footerChip("🌿 feat/agent-workspace")).toEqual({
      kind: "text",
      text: "feat/agent-workspace",
    });
    expect(footerChip("🛠️")).toBeNull();
    expect(footerChip(" — ")).toBeNull();
  });

  it("never leaves emoji in any parsed chip", () => {
    const f = parseClaudeFooter(FULL);
    for (const chip of f?.chips ?? []) {
      expect(chip.text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("formatFooterDuration", () => {
  it("formats compact spans and switches to days past 48 hours", () => {
    expect(formatFooterDuration("193h43m")).toBe("8d 1h");
    expect(formatFooterDuration("5h 3m")).toBe("5h 3m");
    expect(formatFooterDuration("47h59m")).toBe("47h 59m");
    expect(formatFooterDuration("7m 26s")).toBe("7m 26s");
    expect(formatFooterDuration("12s")).toBe("12s");
    expect(formatFooterDuration("soon")).toBe("soon");
  });
});

describe("sameFooter", () => {
  it("compares lines, mode and agents", () => {
    const a = parseClaudeFooter(FULL);
    expect(sameFooter(a, parseClaudeFooter(FULL))).toBe(true);
    expect(
      sameFooter(a, parseClaudeFooter(FULL.replace("7m 26s", "7m 27s"))),
    ).toBe(false);
    expect(sameFooter(null, a)).toBe(false);
  });
});

describe("stripEmoji", () => {
  it("drops emoji and their combiners but never the letters next to them", () => {
    expect(stripEmoji("🛠️ Opus")).toBe("Opus");
    expect(stripEmoji("Meesho 🛠️ Opus 5.5")).toBe("Meesho Opus 5.5");
    expect(stripEmoji("📁 Notes")).toBe("Notes");
    expect(stripEmoji("💰 $1.23")).toBe("$1.23");
    expect(stripEmoji("⏱️ 8d")).toBe("8d");
    expect(stripEmoji("1️⃣ one")).toBe("1 one");
    expect(stripEmoji("👍🏽 ok")).toBe("ok");
    expect(stripEmoji("🧑‍💻 dev")).toBe("dev");
  });
});

describe("model segment", () => {
  it("keeps the model whole and the label before it as the account", () => {
    expect(footerChip("Meesho 🛠️ Opus 5.5")).toEqual({
      kind: "model",
      text: "Meesho Opus 5.5",
      model: "Opus 5.5",
      account: "Meesho",
    });
  });

  it("restores a model name whose first letter the screen lost after a wide emoji", () => {
    expect(footerChip("Meesho 🛠️ pus 5.5")).toMatchObject({
      kind: "model",
      model: "Opus 5.5",
      account: "Meesho",
    });
    expect(footerChip("onnet 4.5")).toMatchObject({ model: "Sonnet 4.5" });
  });

  it("reads the context bar and percent", () => {
    expect(footerChip("🧠 [██░] 57%")).toMatchObject({
      kind: "context",
      percent: 57,
    });
  });
});
