import { describe, expect, it } from "vitest";
import {
  buildOutline,
  filterBlocks,
  findMatches,
  mergeThinking,
  promptPayload,
  promptWrites,
  sessionStats,
  turnMarkdown,
  turnSummary,
} from "./readerDoc";
import {
  type ReaderBlock,
  type ReaderTurn,
  stripImagePlaceholders,
  type ToolCall,
} from "./transcript";

function call(
  id: string,
  name: string,
  extra: Partial<ToolCall> = {},
): ToolCall {
  return {
    id,
    name,
    input: {},
    status: "done",
    result: null,
    filePath: null,
    diff: null,
    stdout: null,
    stderr: null,
    interrupted: false,
    children: [],
    timestamp: null,
    ...extra,
  };
}

const think = (
  id: string,
  text: string,
  durationMs: number | null,
): ReaderBlock => ({
  kind: "thinking",
  id,
  text,
  durationMs,
});

function turn(extra: Partial<ReaderTurn> = {}): ReaderTurn {
  return {
    id: "t1",
    prompt: "fix the bug\nmore detail",
    command: null,
    promptAt: "2026-11-04T10:00:00Z",
    images: [],
    blocks: [],
    ...extra,
  };
}

describe("mergeThinking", () => {
  it("folds consecutive thoughts, sums durations and drops empty ones", () => {
    const out = mergeThinking([
      think("a", "", 1000),
      think("b", "**plan**", 2000),
      think("c", "", null),
      { kind: "text", id: "x", text: "hi" },
      think("d", "", 0),
      think("e", "", 3000),
    ]);
    expect(out).toEqual([
      { kind: "thinking", id: "a", text: "**plan**", durationMs: 3000 },
      { kind: "text", id: "x", text: "hi" },
      { kind: "thinking", id: "e", text: "", durationMs: 3000 },
    ]);
  });
});

describe("filterBlocks", () => {
  it("hides tools or thinking on request", () => {
    const blocks: ReaderBlock[] = [
      think("a", "x", 1),
      { kind: "tool", id: "c", call: call("c", "Bash") },
      { kind: "text", id: "t", text: "y" },
    ];
    expect(
      filterBlocks(blocks, { tools: false, thinking: true }).map((b) => b.id),
    ).toEqual(["a", "t"]);
    expect(
      filterBlocks(blocks, { tools: true, thinking: false }).map((b) => b.id),
    ).toEqual(["c", "t"]);
  });
});

describe("outline and stats", () => {
  const sub = call("s", "Edit", { filePath: "/r/b.ts" });
  const t = turn({
    blocks: [
      {
        kind: "tool",
        id: "1",
        call: call("1", "Read", { filePath: "/r/a.ts" }),
      },
      {
        kind: "tool",
        id: "2",
        call: call("2", "Edit", { filePath: "/r/a.ts" }),
      },
      {
        kind: "tool",
        id: "3",
        call: call("3", "Task", {
          children: [{ kind: "tool", id: "s", call: sub }],
        }),
      },
      { kind: "tool", id: "4", call: call("4", "Bash", { status: "error" }) },
    ],
  });

  it("summarises each turn", () => {
    expect(buildOutline([t])).toEqual([
      {
        id: "t1",
        summary: "fix the bug",
        at: "2026-11-04T10:00:00Z",
        tools: 5,
        edits: 2,
        images: 0,
        pinnable: true,
      },
    ]);
    expect(turnSummary(turn({ prompt: null, command: "review" }))).toBe(
      "/review",
    );
    expect(
      turnSummary(turn({ prompt: null, images: [{ offset: 1, index: 0 }] })),
    ).toBe("Image");
    expect(turnSummary(turn({ prompt: "x".repeat(200) })).length).toBe(80);
  });

  it("counts calls and lists edited files once", () => {
    expect(sessionStats([t])).toEqual({
      turns: 1,
      toolCalls: 5,
      errors: 1,
      files: ["/r/a.ts", "/r/b.ts"],
    });
  });

  it("copies a turn as Markdown", () => {
    const md = turnMarkdown(
      turn({
        blocks: [
          { kind: "text", id: "x", text: "Done." },
          {
            kind: "tool",
            id: "b",
            call: call("b", "Bash", { input: { command: "ls -la\nmore" } }),
          },
        ],
      }),
    );
    expect(md).toBe(
      "**You:** fix the bug\nmore detail\n\nDone.\n\n- `Bash` `ls -la`",
    );
  });
});

describe("findMatches", () => {
  it("finds case-insensitive, non-overlapping matches", () => {
    expect(findMatches("Aaa aA", "aa")).toEqual([0, 4]);
    expect(findMatches("abc", "")).toEqual([]);
  });
});

describe("promptPayload", () => {
  it("types single lines as-is and wraps multi-line prompts in a paste", () => {
    expect(promptPayload("hello", true)).toBe("hello");
    expect(promptPayload("a\r\nb", true)).toBe("\x1b[200~a\nb\x1b[201~");
    expect(promptPayload("a\n  b", false)).toBe("a b");
    expect(promptPayload("x\x1b[201~y\nz", true)).toBe(
      "\x1b[200~x␛[201~y\nz\x1b[201~",
    );
  });
});

describe("stripImagePlaceholders", () => {
  it("removes image tokens and source lines but keeps the prompt", () => {
    expect(stripImagePlaceholders("[Image #24] check this")).toBe("check this");
    expect(
      stripImagePlaceholders(
        "[Image #1] [Image #2] compare\n[Image: source: /tmp/a b.png]",
      ),
    ).toBe("compare");
    expect(stripImagePlaceholders("[Image #3]")).toBe("");
  });

  it("keeps the user's own spacing and the first line's indent", () => {
    const diagram = "   ┌──┐   x\n   │  │   y";
    expect(stripImagePlaceholders(`\n${diagram}\n`)).toBe(diagram);
    expect(stripImagePlaceholders("see [Image #2] here")).toBe("see here");
  });
});

describe("promptWrites", () => {
  const paste = (s: string) => `\x1b[200~${s}\x1b[201~`;

  it("pastes each image path on its own, then the text", () => {
    expect(
      promptWrites("what is this?", ["/c/a.png", "/c/b.jpg"], true),
    ).toEqual([paste("/c/a.png"), paste("/c/b.jpg"), " what is this?"]);
  });

  it("sends images alone when there is no text, and text alone without images", () => {
    expect(promptWrites("  ", ["/c/a.png"], true)).toEqual([paste("/c/a.png")]);
    expect(promptWrites("hi", [], true)).toEqual(["hi"]);
    expect(promptWrites("", [], true)).toEqual([]);
  });

  it("keeps multi-line text as one paste and types paths without bracketed paste", () => {
    expect(promptWrites("a\nb", ["/c/a.png"], true)).toEqual([
      paste("/c/a.png"),
      paste(" a\nb"),
    ]);
    expect(promptWrites("a\nb", ["/c/a.png"], false)).toEqual([
      "/c/a.png ",
      " a b",
    ]);
  });

  it("strips control bytes so a path cannot end the paste early", () => {
    expect(promptWrites("", ["/c/x\x1b[201~\r.png"], true)).toEqual([
      paste("/c/x[201~.png"),
    ]);
  });
});
