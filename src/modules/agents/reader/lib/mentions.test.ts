import { describe, expect, it } from "vitest";
import {
  addMention,
  buildChatContext,
  buildDiffContext,
  buildTerminalContext,
  CONTEXT_CAPS,
  capUtf8,
  type Mention,
  mentionKey,
  removeMention,
  serializePrompt,
  specialMentions,
} from "./mentions";
import type { ReaderTurn } from "./transcript";

const file = (ref: string): Mention => ({ kind: "file", label: ref, ref });
const folder = (ref: string): Mention => ({ kind: "folder", label: ref, ref });

describe("pills", () => {
  it("dedupes by kind and ref and removes by key", () => {
    let list = addMention([], file("src/a.ts"));
    list = addMention(list, file("src/a.ts"));
    list = addMention(list, folder("src"));
    expect(list.map(mentionKey)).toEqual(["file:src/a.ts", "folder:src"]);
    expect(removeMention(list, "file:src/a.ts").map(mentionKey)).toEqual([
      "folder:src",
    ]);
  });
});

describe("serializePrompt", () => {
  it("puts file and folder tokens after the text so a /command stays first", () => {
    expect(
      serializePrompt("/review the change", [file("src/a.ts"), folder("docs")]),
    ).toBe("/review the change @src/a.ts @docs/");
  });

  it("adds one line per context file and keeps mentions-only prompts", () => {
    expect(
      serializePrompt(
        "  why does this fail?  ",
        [],
        [
          { label: "git: working diff", path: "/c/1.md" },
          { label: "terminal: fluss", path: "/c/2.md" },
        ],
      ),
    ).toBe(
      "why does this fail?\n\nContext (git: working diff): see /c/1.md\nContext (terminal: fluss): see /c/2.md",
    );
    expect(serializePrompt("", [file("a.md")])).toBe("@a.md");
    expect(serializePrompt("", [])).toBe("");
  });

  it("never emits tokens for context mentions", () => {
    expect(
      serializePrompt("x", [{ kind: "git-working", label: "git", ref: "" }]),
    ).toBe("x");
  });
});

describe("capUtf8", () => {
  it("cuts on a character boundary", () => {
    expect(capUtf8("abc", 10)).toEqual({ text: "abc", truncated: false });
    // "é" is 2 bytes: a cut after 2 bytes must not split it.
    expect(capUtf8("aé", 2)).toEqual({ text: "a", truncated: true });
    expect(capUtf8("€uro", 2).text).toBe("");
  });
});

describe("context builders", () => {
  it("wraps a diff, returns null when empty, caps and flags truncation", () => {
    expect(buildDiffContext("git-working", "  \n")).toBeNull();
    const small = buildDiffContext("git-working", "diff --git a/x b/x\n+1\n");
    expect(small).toContain("```diff\ndiff --git a/x b/x\n+1\n```");
    expect(small).not.toContain("Truncated");
    const huge = buildDiffContext(
      "git-branch",
      "+".repeat(CONTEXT_CAPS.diffBytes + 500),
    );
    expect(huge).toContain("Truncated");
    expect((huge ?? "").length).toBeLessThan(CONTEXT_CAPS.diffBytes + 400);
    expect(buildDiffContext("git-working", "+1", true)).toContain("Truncated");
  });

  it("keeps the last lines of a pane and drops blank edges", () => {
    const text = [
      "",
      "first",
      ...Array.from({ length: 5 }, (_, i) => `l${i}   `),
      "",
      "",
    ].join("\n");
    const out = buildTerminalContext("fluss", text, 3) ?? "";
    expect(out).toContain("last 3 lines");
    expect(out).toContain("```\nl2\nl3\nl4\n```");
    expect(out).not.toContain("first");
    expect(buildTerminalContext("x", "\n \n")).toBeNull();
  });

  it("summarises a past chat, keeping the newest turns within the cap", () => {
    const turn = (i: number, answer: string): ReaderTurn => ({
      id: `t${i}`,
      prompt: `question ${i}`,
      command: null,
      promptAt: null,
      images: [],
      blocks: [
        { kind: "thinking", id: `k${i}`, text: "hidden", durationMs: 1 },
        { kind: "text", id: `a${i}`, text: answer },
      ],
    });
    const turns = [
      turn(1, "a".repeat(500)),
      turn(2, "b".repeat(500)),
      turn(3, "short"),
    ];
    const all = buildChatContext("Storage", turns) ?? "";
    expect(all.startsWith("# Past chat: Storage")).toBe(true);
    expect(all).toContain("## You\n\nquestion 1");
    expect(all).not.toContain("hidden");
    const tight = buildChatContext("Storage", turns, 700) ?? "";
    expect(tight).toContain("earlier turns omitted");
    expect(tight).toContain("question 3");
    expect(tight).not.toContain("question 1");
    expect(buildChatContext("x", [])).toBeNull();
  });
});

describe("specialMentions", () => {
  const sources = {
    git: true,
    panes: [{ leafId: 7, label: "fluss", detail: "~/Notes/fluss" }],
    chats: [
      { sessionId: "s1", title: "Storage tiers", detail: "yesterday" },
      { sessionId: "s2", title: "Airflow alerts", detail: "today" },
    ],
  };

  it("lists everything for an empty query and by keyword prefix", () => {
    expect(specialMentions("", sources).map((m) => m.kind)).toEqual([
      "git-working",
      "git-branch",
      "terminal",
      "chat",
      "chat",
    ]);
    expect(specialMentions("g", sources).map((m) => m.kind)).toEqual([
      "git-working",
      "git-branch",
    ]);
    expect(specialMentions("ter", sources).map((m) => m.ref)).toEqual(["7"]);
  });

  it("narrows by label after the keyword and ignores plain file queries", () => {
    expect(specialMentions("chat stor", sources).map((m) => m.ref)).toEqual([
      "s1",
    ]);
    expect(specialMentions("chat:air", sources).map((m) => m.ref)).toEqual([
      "s2",
    ]);
    expect(specialMentions("src/a", sources)).toEqual([]);
    expect(
      specialMentions("", { ...sources, git: false }).map((m) => m.kind),
    ).not.toContain("git-working");
  });
});
