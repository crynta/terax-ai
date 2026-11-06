import { describe, expect, it } from "vitest";
import { parseClaudeDialog } from "@/modules/agents/reader/lib/claudeDialog";
import { parseClaudeFooter } from "@/modules/agents/reader/lib/claudeFooter";
import { ScreenMirror } from "../src/screen";

const ESC = "\x1b";
/** Ink's redraw: move up over the previous frame, clearing each line. */
const eraseLines = (n: number) =>
  `${`${ESC}[2K${ESC}[1A`.repeat(Math.max(0, n - 1))}${ESC}[2K${ESC}[G`;

const frame = (lines: string[]) => lines.join("\r\n");

const PROMPT_FRAME = [
  "╭────────────────────────────────────────────╮",
  "│ >                                          │",
  "╰────────────────────────────────────────────╯",
  "  Meesho 🧠 Opus 5.5 | Notes | 50%",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
];

const DIALOG_FRAME = [
  "╭──────────────────────────────────────────────╮",
  "│ Bash command                                 │",
  "│                                              │",
  "│   git status --short                         │",
  "│   Show working tree status                   │",
  "│                                              │",
  "│ Do you want to proceed?                      │",
  "│ ❯ 1. Yes                                     │",
  "│   2. Yes, and don't ask again for git status │",
  "│   3. No, and tell Claude what to do (esc)    │",
  "╰──────────────────────────────────────────────╯",
];

async function screenAfter(chunks: string[], cols = 220, rows = 60): Promise<string> {
  const mirror = new ScreenMirror(cols, rows);
  for (const c of chunks) mirror.write(c);
  await mirror.flush();
  const text = mirror.screenText();
  mirror.dispose();
  return text;
}

describe("ScreenMirror", () => {
  it("rebuilds a permission dialog drawn over the prompt frame", async () => {
    const screen = await screenAfter([
      "● I'll check the working tree.\r\n\r\n",
      frame(PROMPT_FRAME),
      eraseLines(PROMPT_FRAME.length),
      frame(DIALOG_FRAME),
    ]);
    const dialog = parseClaudeDialog(screen);
    expect(dialog).not.toBeNull();
    expect(dialog?.options.map((o) => o.label)[0]).toMatch(/^Yes/u);
    expect(dialog?.options).toHaveLength(3);
    expect(screen).not.toContain("auto mode on");
  });

  it("drops the dialog once Claude redraws the prompt", async () => {
    const screen = await screenAfter([
      frame(DIALOG_FRAME),
      eraseLines(DIALOG_FRAME.length),
      "● Bash(git status --short)\r\n",
      frame(PROMPT_FRAME),
    ]);
    expect(parseClaudeDialog(screen)).toBeNull();
    expect(parseClaudeFooter(screen)).not.toBeNull();
  });

  it("keeps output a real 80-column terminal scrolled away above the frame", async () => {
    const history = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\r\n");
    const screen = await screenAfter([history, "\r\n", frame(PROMPT_FRAME)], 220, 30);
    const lines = screen.split("\n");
    expect(lines).toHaveLength(30);
    expect(lines.at(-1)).toContain("auto mode on");
  });

  it("reports bracketed paste mode", async () => {
    const mirror = new ScreenMirror(80, 24);
    expect(mirror.bracketedPaste).toBe(false);
    mirror.write(`${ESC}[?2004h`);
    await mirror.flush();
    expect(mirror.bracketedPaste).toBe(true);
    mirror.dispose();
  });
});
