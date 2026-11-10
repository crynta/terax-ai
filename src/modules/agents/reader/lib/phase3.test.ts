import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = vi.fn(async () => undefined);
    set = vi.fn(async () => {});
    save = vi.fn(async () => {});
  },
}));

import { claudeResumeCommand } from "@/modules/agents/lib/agentLaunchBridge";
import { parseClaudeDialog } from "./claudeDialog";
import { compactBanner, compactCommand } from "./contextBanner";
import type { PastChat } from "./contextClient";
import { documentMarkdown, exportFileName } from "./exportMarkdown";
import {
  chatTitle,
  filterHistory,
  groupHistory,
  historyGroupOf,
  relativeTime,
} from "./history";
import {
  inputBoxText,
  isRestoreMenu,
  matchKey,
  parseRewindPicker,
  planRewindStep,
  promptOccurrence,
  restoreKeys,
  restoreOptionFor,
  rewindTargetIndex,
} from "./rewind";
import { normalizeSessionTitle, withSessionTitle } from "./sessionTitles";
import type { ReaderDocument } from "./transcript";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing value");
  return value;
}

const NOW = new Date("2026-11-04T15:00:00").getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function chat(
  id: string,
  ageMs: number,
  extra: Partial<PastChat> = {},
): PastChat {
  return {
    sessionId: id,
    modifiedMs: NOW - ageMs,
    size: 100,
    title: null,
    firstPrompt: null,
    ...extra,
  };
}

describe("chat history", () => {
  it("buckets sessions by day", () => {
    expect(historyGroupOf(NOW - HOUR, NOW)).toBe("today");
    expect(historyGroupOf(NOW - 20 * HOUR, NOW)).toBe("yesterday");
    expect(historyGroupOf(NOW - 4 * DAY, NOW)).toBe("week");
    expect(historyGroupOf(NOW - 30 * DAY, NOW)).toBe("older");
  });

  it("titles prefer a Terax name, then /rename, the AI title, the first prompt", () => {
    const c = chat("a", 0, {
      title: "AI title",
      customTitle: "Renamed",
      firstPrompt: "first",
    });
    expect(chatTitle(c, { a: "Mine" })).toBe("Mine");
    expect(chatTitle(c)).toBe("Renamed");
    expect(chatTitle({ ...c, customTitle: null })).toBe("AI title");
    expect(chatTitle(chat("b", 0, { firstPrompt: "only prompt" }))).toBe(
      "only prompt",
    );
    expect(chatTitle(chat("c", 0))).toBe("Untitled chat");
  });

  it("filters by every word and adds full-text prompt matches", () => {
    const chats = [
      chat("a", HOUR, { title: "Fluss storage tiers", firstPrompt: "explain" }),
      chat("b", 2 * DAY, { title: "Flaky test", firstPrompt: "fix the test" }),
      chat("c", 40 * DAY, { title: "Airflow", firstPrompt: "dags" }),
    ];
    expect(filterHistory(chats, "").map((r) => r.chat.sessionId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      filterHistory(chats, "FLUSS tiers").map((r) => r.chat.sessionId),
    ).toEqual(["a"]);
    const rows = filterHistory(chats, "retry", [
      { sessionId: "c", snippet: "…add a retry to the dag…" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      matched: true,
      preview: "…add a retry to the dag…",
    });
    const groups = groupHistory(filterHistory(chats, ""), NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "This week", "Older"]);
  });

  it("formats relative times", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(relativeTime(NOW - 20 * HOUR, NOW)).toBe("yesterday");
    expect(relativeTime(NOW - 4 * DAY, NOW)).toBe("4d ago");
  });
});

describe("session titles", () => {
  it("normalises to one capped line", () => {
    expect(normalizeSessionTitle("  Fix\nthe   flaky\ttest ")).toBe(
      "Fix the flaky test",
    );
    expect(normalizeSessionTitle("   ")).toBeNull();
    expect(normalizeSessionTitle("x".repeat(200))).toHaveLength(80);
  });

  it("sets and clears names", () => {
    const one = withSessionTitle({}, "a", "  Name ");
    expect(one).toEqual({ a: "Name" });
    expect(withSessionTitle(one, "a", null)).toEqual({});
    expect(withSessionTitle(one, "a", "   ")).toEqual({});
  });
});

describe("markdown export", () => {
  const doc: ReaderDocument = {
    title: "Storage",
    turns: [
      {
        id: "t1",
        prompt: "explain the tiers",
        command: null,
        promptAt: "2026-11-04T10:00:00Z",
        images: [],
        blocks: [{ kind: "text", text: "Three tiers." } as never],
      },
    ],
  };

  it("writes a title block and one section per turn", () => {
    const md = documentMarkdown(doc, {
      title: "Storage tiers",
      cwd: "/Users/a/proj",
      sessionId: "id-1",
      exportedAt: Date.parse("2026-11-04T12:00:00Z"),
    });
    expect(md.startsWith("# Storage tiers\n")).toBe(true);
    expect(md).toContain("Folder: `/Users/a/proj`");
    expect(md).toContain("## Turn 1 · 2026-11-04 10:00");
    expect(md).toContain("**You:** explain the tiers");
    expect(md).toContain("Three tiers.");
    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("names the file after the title and date", () => {
    expect(
      exportFileName(
        "Fix: the flaky test!",
        Date.parse("2026-11-04T12:00:00Z"),
      ),
    ).toBe("fix-the-flaky-test-2026-11-04.md");
    expect(exportFileName("!!!", Date.parse("2026-11-04T12:00:00Z"))).toBe(
      "claude-chat-2026-11-04.md",
    );
  });
});

const BOXED_PICKER = [
  "╭──────────────────────────────────────────────────────╮",
  "│ Rewind                                               │",
  "│                                                      │",
  "│ Restore the code and/or conversation to the point    │",
  "│ before…                                              │",
  "│                                                      │",
  "│   explain the storage tiers                          │",
  "│     No code changes                                  │",
  "│   fix the flaky test in the reader                   │",
  "│     2 files changed +10 -3                           │",
  "│ ❯ (current)                                          │",
  "│                                                      │",
  "│ Enter to select · Esc to cancel                      │",
  "╰──────────────────────────────────────────────────────╯",
].join("\n");

const PLAIN_NEWEST_FIRST = [
  " Rewind",
  " Choose a message to restore to",
  "",
  " ❯ (current)",
  "   can you explain that 3 level storage like it also us…",
  "   /model",
  "   hello",
  "",
  " ↑/↓ to navigate · Enter to select · Esc to cancel",
].join("\n");

const RESTORE_MENU = [
  " Rewind",
  " Restore to before: fix the flaky test in the reader",
  "",
  " ❯ 1. Restore code and conversation",
  "   2. Restore conversation",
  "   3. Restore code",
  "   4. Never mind",
].join("\n");

describe("rewind picker", () => {
  it("parses a boxed list oldest first, skipping secondary lines", () => {
    const picker = parseRewindPicker(BOXED_PICKER);
    expect(picker).not.toBeNull();
    expect(picker?.items.map((i) => i.text)).toEqual([
      "explain the storage tiers",
      "fix the flaky test in the reader",
      "(current)",
    ]);
    expect(picker?.selectedIndex).toBe(2);
    expect(picker?.newestFirst).toBe(false);
  });

  it("parses a plain newest-first list and matches truncated prompts", () => {
    const picker = parseRewindPicker(PLAIN_NEWEST_FIRST);
    expect(picker?.newestFirst).toBe(true);
    const long =
      "can you explain that 3 level storage like it also used gcs for some old logs like that things ...";
    expect(rewindTargetIndex(must(picker), long)).toBe(1);
    expect(rewindTargetIndex(must(picker), "/model")).toBe(2);
    expect(rewindTargetIndex(must(picker), "something else")).toBe(-1);
  });

  it("plans arrows towards the prompt, Enter on it, and scrolls when off screen", () => {
    const boxed = must(parseRewindPicker(BOXED_PICKER));
    expect(planRewindStep(boxed, "explain the storage tiers")).toEqual({
      kind: "move",
      keys: "\x1b[A\x1b[A",
    });
    const plain = must(parseRewindPicker(PLAIN_NEWEST_FIRST));
    expect(planRewindStep(plain, "hello")).toEqual({
      kind: "move",
      keys: "\x1b[B\x1b[B\x1b[B",
    });
    expect(planRewindStep(plain, "much older prompt")).toEqual({
      kind: "scroll",
      keys: "\x1b[B",
    });
    expect(planRewindStep(boxed, "much older prompt")).toEqual({
      kind: "scroll",
      keys: "\x1b[A",
    });
    const onTarget = must(
      parseRewindPicker(
        BOXED_PICKER.replace("│   explain", "│ ❯ explain").replace(
          "│ ❯ (current)",
          "│   (current)",
        ),
      ),
    );
    expect(planRewindStep(onTarget, "explain the storage tiers")).toEqual({
      kind: "enter",
    });
  });

  it("picks the right copy of a repeated prompt", () => {
    const screen = [
      " Rewind",
      "   continue",
      "   other",
      "   continue",
      " ❯ (current)",
    ].join("\n");
    const picker = must(parseRewindPicker(screen));
    expect(rewindTargetIndex(picker, "continue", 0)).toBe(0);
    expect(rewindTargetIndex(picker, "continue", 1)).toBe(2);
    expect(promptOccurrence(["continue", "other", "continue"], 2)).toBe(1);
    expect(promptOccurrence(["continue", "other", "continue"], 0)).toBe(0);
  });

  it("does not take other screens for the picker", () => {
    expect(parseRewindPicker(RESTORE_MENU)).toBeNull();
    const permission = [
      " Bash command",
      "   git status",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. No",
    ].join("\n");
    expect(parseRewindPicker(permission)).toBeNull();
    const resume = [
      " Resume session",
      " ❯ yesterday's chat",
      "   older chat",
    ].join("\n");
    expect(parseRewindPicker(resume)).toBeNull();
    expect(parseRewindPicker("")).toBeNull();
  });

  it("maps restore choices onto the menu", () => {
    const menu = must(parseClaudeDialog(RESTORE_MENU));
    expect(isRestoreMenu(menu)).toBe(true);
    expect(restoreOptionFor(menu, "both")).toBe(1);
    expect(restoreOptionFor(menu, "conversation")).toBe(2);
    expect(restoreOptionFor(menu, "code")).toBe(3);
    expect(restoreOptionFor(menu, "cancel")).toBe(4);
    expect(restoreKeys(menu, "conversation")).toBe("\x1b[B\r");
    const permission = must(
      parseClaudeDialog(
        [" Do you want to proceed?", " ❯ 1. Yes", "   2. No"].join("\n"),
      ),
    );
    expect(isRestoreMenu(permission)).toBe(false);
  });

  it("normalises match keys", () => {
    expect(matchKey("  Can you   explain…")).toBe("can you explain");
    expect(matchKey("hello...")).toBe("hello");
  });
});

describe("Claude input box", () => {
  it("reads the text between the rules after the prompt marker", () => {
    const screen = [
      "some output",
      "────────────────────────────────────────",
      "❯ fix the flaky test",
      "  in the reader",
      "────────────────────────────────────────",
      "  ⏵⏵ auto mode on (shift+tab to cycle)",
    ].join("\n");
    expect(inputBoxText(screen)).toBe("fix the flaky test\nin the reader");
    const empty = ["────────────────", "❯ ", "────────────────"].join("\n");
    expect(inputBoxText(empty)).toBe("");
    expect(inputBoxText("no box here")).toBeNull();
  });
});

describe("context banner", () => {
  it("shows from 85% and turns red at 95%", () => {
    expect(compactBanner(null)).toBeNull();
    expect(compactBanner(84.4)).toBeNull();
    expect(compactBanner(85)).toEqual({ tone: "warn", percent: 85 });
    expect(compactBanner(96)).toEqual({ tone: "high", percent: 96 });
  });

  it("stays dismissed until context grows five points", () => {
    expect(compactBanner(88, 87)).toBeNull();
    expect(compactBanner(92, 87)).toEqual({ tone: "warn", percent: 92 });
  });

  it("builds the compact command", () => {
    expect(compactCommand("")).toBe("/compact");
    expect(compactCommand("  keep the\nplan ")).toBe("/compact keep the plan");
  });
});

describe("resume command", () => {
  const id = "0b5f4c2e-9a1d-4e3b-8c7f-1234567890ab";
  it("adds --resume and --fork-session", () => {
    expect(claudeResumeCommand("claude", id)).toBe(`claude --resume ${id}`);
    expect(claudeResumeCommand(" claude --model opus ", id, true)).toBe(
      `claude --model opus --resume ${id} --fork-session`,
    );
  });
  it("rejects bad ids and multi-line commands", () => {
    expect(claudeResumeCommand("claude", "../../etc")).toBeNull();
    expect(claudeResumeCommand("claude\nrm -rf /", id)).toBeNull();
    expect(claudeResumeCommand("  ", id)).toBeNull();
  });
});
