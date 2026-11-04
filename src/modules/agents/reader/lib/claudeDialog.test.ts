import { describe, expect, it } from "vitest";
import {
  cleanScreenLine,
  dialogKeys,
  optionTone,
  parseClaudeDialog,
  sameDialog,
} from "./claudeDialog";

const screen = (...lines: string[]) => lines.join("\n");

const BOXED_BASH = screen(
  "● I'll check the working tree.",
  "",
  "╭──────────────────────────────────────────────────────────────╮",
  "│ Bash command                                                 │",
  "│                                                              │",
  "│   git status --short                                         │",
  "│   Show working tree status                                   │",
  "│                                                              │",
  "│ Do you want to proceed?                                      │",
  "│ ❯ 1. Yes                                                     │",
  "│   2. Yes, and don't ask again for git status commands in     │",
  "│   /Users/me/repo                                             │",
  "│   3. No, and tell Claude what to do differently (esc)        │",
  "╰──────────────────────────────────────────────────────────────╯",
  "",
);

const RULED_EDIT = screen(
  "● Update(src/app.ts)",
  "────────────────────────────────────────────────────────────────",
  " Edit file",
  " src/app.ts",
  "   12 -  const a = 1;",
  "   12 +  const a = 2;",
  " Do you want to make this edit to app.ts?",
  "   1. Yes",
  " ❯ 2. Yes, allow all edits during this session (shift+tab)",
  "   3. No, and tell Claude what to do differently (esc)",
  "",
  "  Meesho 🧠 Opus 5.5 | Notes | 50%",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
);

const ASK_QUESTION = screen(
  "────────────────────────────────────────────────",
  " ☐ Font",
  "",
  "Which font should I bundle?",
  "",
  "❯ 1. Red Hat Mono",
  "     Clean and geometric.",
  "  2. Geist Mono",
  "     Modern and crisp.",
  "  3. Type something.",
  "",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
);

describe("parseClaudeDialog", () => {
  it("reads a boxed Bash permission prompt with its command and wrapped option", () => {
    const d = parseClaudeDialog(BOXED_BASH);
    expect(d).not.toBeNull();
    expect(d?.kind).toBe("command");
    expect(d?.header).toBe("Bash command");
    expect(d?.details).toEqual([
      "git status --short",
      "Show working tree status",
    ]);
    expect(d?.question).toBe("Do you want to proceed?");
    expect(d?.options.map((o) => [o.n, o.selected, o.escape])).toEqual([
      [1, true, false],
      [2, false, false],
      [3, false, true],
    ]);
    expect(d?.options[1].description).toBe("/Users/me/repo");
    expect(d?.options[2].label).toBe(
      "No, and tell Claude what to do differently",
    );
  });

  it("reads a ruled edit prompt above a status line and keeps the current selection", () => {
    const d = parseClaudeDialog(RULED_EDIT);
    expect(d?.kind).toBe("edit");
    expect(d?.header).toBe("Edit file");
    expect(d?.details[0]).toBe("src/app.ts");
    expect(d?.options.find((o) => o.selected)?.n).toBe(2);
    expect(d?.options[1].label).toBe(
      "Yes, allow all edits during this session",
    );
  });

  it("reads an AskUserQuestion choice with option descriptions", () => {
    const d = parseClaudeDialog(ASK_QUESTION);
    expect(d?.kind).toBe("question");
    expect(d?.question).toBe("Which font should I bundle?");
    expect(d?.options.map((o) => o.label)).toEqual([
      "Red Hat Mono",
      "Geist Mono",
      "Type something.",
    ]);
    expect(d?.options[0].description).toBe("Clean and geometric.");
    expect(d?.multiSelect).toBe(false);
  });

  it("recognises the plan approval prompt", () => {
    const d = parseClaudeDialog(
      screen(
        "Would you like to proceed?",
        "❯ 1. Yes, and auto-accept edits",
        "  2. Yes, and manually approve edits",
        "  3. No, keep planning",
      ),
    );
    expect(d?.kind).toBe("plan");
  });

  it("flags checkbox questions as multi-select", () => {
    const d = parseClaudeDialog(
      screen(
        "Which upgrades do you want?",
        "❯ 1. [ ] Sidebar",
        "  2. [x] Theme",
        "  3. Submit",
      ),
    );
    expect(d?.multiSelect).toBe(true);
  });

  it("ignores a numbered list in ordinary output", () => {
    expect(
      parseClaudeDialog(
        screen(
          "● Here's the plan:",
          "  1. Build the app",
          "  2. Install it",
          "  3. Restart Terax",
          "",
          "❯ ",
          "  ? for shortcuts",
        ),
      ),
    ).toBeNull();
  });

  it("ignores options with no selection marker or two of them", () => {
    expect(parseClaudeDialog(screen("Pick one?", "1. A", "2. B"))).toBeNull();
    expect(
      parseClaudeDialog(screen("Pick one?", "❯ 1. A", "❯ 2. B")),
    ).toBeNull();
  });

  it("ignores a dialog-shaped block that scrolled far above the bottom", () => {
    const filler = Array.from({ length: 10 }, (_, i) => `output line ${i}`);
    expect(parseClaudeDialog(screen(BOXED_BASH, ...filler))).toBeNull();
  });

  it("ignores runs that don't start at 1", () => {
    expect(parseClaudeDialog(screen("Next?", "❯ 2. A", "  3. B"))).toBeNull();
  });
});

describe("dialog helpers", () => {
  it("strips box borders from both sides", () => {
    expect(cleanScreenLine("│ ❯ 1. Yes      │")).toBe("❯ 1. Yes");
    expect(cleanScreenLine("plain   ")).toBe("plain");
  });

  it("moves with arrows from the selected option, then presses Enter", () => {
    const d = parseClaudeDialog(RULED_EDIT);
    if (!d) throw new Error("expected a dialog");
    expect(dialogKeys(d, 2)).toBe("\r");
    expect(dialogKeys(d, 3)).toBe("\x1b[B\r");
    expect(dialogKeys(d, 1)).toBe("\x1b[A\r");
    expect(dialogKeys(d, 7)).toBeNull();
  });

  it("compares dialogs by question, options and selection", () => {
    const a = parseClaudeDialog(BOXED_BASH);
    const b = parseClaudeDialog(BOXED_BASH);
    expect(sameDialog(a, b)).toBe(true);
    expect(sameDialog(a, parseClaudeDialog(RULED_EDIT))).toBe(false);
    expect(sameDialog(null, null)).toBe(true);
  });

  it("styles the first option primary and No/esc options as danger", () => {
    const d = parseClaudeDialog(BOXED_BASH);
    expect(d?.options.map(optionTone)).toEqual([
      "primary",
      "neutral",
      "danger",
    ]);
  });
});
