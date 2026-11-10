import { describe, expect, it } from "vitest";
import {
  buildDocument,
  lineDiff,
  pastedSpans,
  shellOutput,
  stripAnsi,
  TranscriptBuffer,
  type TranscriptEntry,
  type TranscriptPage,
  taskNotice,
} from "./transcript";

const prompt = (uuid: string, text: string): TranscriptEntry => ({
  kind: "user",
  uuid,
  timestamp: "2026-11-04T10:00:00Z",
  blocks: [{ type: "text", text }],
});

const assistant = (
  blocks: TranscriptEntry["blocks"],
  extra: Partial<TranscriptEntry> = {},
): TranscriptEntry => ({ kind: "assistant", blocks, ...extra });

const result = (
  toolUseId: string,
  content: string,
  extra: Partial<TranscriptEntry> = {},
): TranscriptEntry => ({
  kind: "user",
  blocks: [{ type: "toolResult", toolUseId, content, isError: false }],
  ...extra,
});

describe("buildDocument", () => {
  it("groups prompts, text, thinking and paired tool calls into turns", () => {
    const doc = buildDocument([
      { kind: "title", text: "Fix the login bug" },
      prompt("u1", "fix login"),
      assistant([{ type: "thinking", text: "" }], { thinkingDurationMs: 2400 }),
      assistant([
        { type: "text", text: "Checking the handler." },
        {
          type: "toolUse",
          id: "t1",
          name: "Bash",
          input: { command: "ls src" },
        },
      ]),
      result("t1", "a.ts\nb.ts", { toolUseResult: { stdout: "a.ts\nb.ts" } }),
      assistant([{ type: "text", text: "  " }]),
      prompt("u2", "thanks"),
    ]);
    expect(doc.title).toBe("Fix the login bug");
    expect(doc.turns.map((t) => t.prompt)).toEqual(["fix login", "thanks"]);
    const [first] = doc.turns;
    expect(first.blocks.map((b) => b.kind)).toEqual([
      "thinking",
      "text",
      "tool",
    ]);
    expect(first.blocks[0]).toMatchObject({ durationMs: 2400 });
    const tool = first.blocks[2];
    expect(tool.kind === "tool" && tool.call).toMatchObject({
      name: "Bash",
      status: "done",
      result: "a.ts\nb.ts",
      stdout: "a.ts\nb.ts",
    });
  });

  it("shows edits as diffs, keeps running calls running and marks errors", () => {
    const doc = buildDocument([
      prompt("u1", "rename"),
      assistant([
        {
          type: "toolUse",
          id: "e1",
          name: "Edit",
          input: { file_path: "/r/a.ts" },
        },
        {
          type: "toolUse",
          id: "r1",
          name: "Read",
          input: { file_path: "/r/b.ts" },
        },
        {
          type: "toolUse",
          id: "x1",
          name: "Bash",
          input: { command: "false" },
        },
      ]),
      result("e1", "ok", {
        toolUseResult: {
          filePath: "/r/a.ts",
          oldString: "let a = 1;",
          newString: "let b = 1;",
        },
      }),
      {
        kind: "user",
        blocks: [
          {
            type: "toolResult",
            toolUseId: "x1",
            content: "exit 1",
            isError: true,
          },
        ],
      },
    ]);
    const calls = doc.turns[0].blocks.flatMap((b) =>
      b.kind === "tool" ? [b.call] : [],
    );
    expect(calls.map((c) => [c.name, c.status, c.filePath])).toEqual([
      ["Edit", "done", "/r/a.ts"],
      ["Read", "running", "/r/b.ts"],
      ["Bash", "error", null],
    ]);
    expect(calls[0].diff).toEqual([
      { kind: "remove", text: "let a = 1;" },
      { kind: "add", text: "let b = 1;" },
    ]);
  });

  it("nests sidechain work under the running Task call", () => {
    const doc = buildDocument([
      prompt("u1", "research"),
      assistant([
        {
          type: "toolUse",
          id: "task",
          name: "Task",
          input: { description: "dig" },
        },
      ]),
      assistant([{ type: "text", text: "sub finding" }], { isSidechain: true }),
      result("task", "summary"),
      assistant([{ type: "text", text: "Done." }]),
    ]);
    const blocks = doc.turns[0].blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "text"]);
    const task = blocks[0].kind === "tool" ? blocks[0].call : null;
    expect(task?.children).toEqual([
      { kind: "text", id: expect.any(String), text: "sub finding" },
    ]);
  });

  it("renders slash commands, skips meta and caveats, and keeps orphan output", () => {
    const doc = buildDocument([
      assistant([{ type: "text", text: "continuing from before the window" }]),
      {
        kind: "user",
        isMeta: true,
        blocks: [
          { type: "text", text: "<system-reminder>x</system-reminder>" },
        ],
      },
      prompt("c1", "<local-command-caveat>Caveat</local-command-caveat>"),
      prompt(
        "c2",
        "<command-name>/plan</command-name>\n<command-message>plan</command-message>\n<command-args>add a sidebar</command-args>",
      ),
      prompt(
        "c3",
        "<local-command-stdout>Enabled plan mode</local-command-stdout>",
      ),
    ]);
    expect(doc.turns).toHaveLength(2);
    expect(doc.turns[0]).toMatchObject({ prompt: null, command: null });
    expect(doc.turns[1]).toMatchObject({
      command: "/plan",
      prompt: "add a sidebar",
    });
    expect(doc.turns[1].blocks).toEqual([
      { kind: "notice", id: expect.any(String), text: "Enabled plan mode" },
    ]);
  });

  it("diffs a Write from its input content", () => {
    const doc = buildDocument([
      assistant([
        {
          type: "toolUse",
          id: "w",
          name: "Write",
          input: { file_path: "/r/n.md", content: "# Hi\nthere" },
        },
      ]),
      result("w", "created", { toolUseResult: { filePath: "/r/n.md" } }),
    ]);
    const block = doc.turns[0].blocks[0];
    expect(block.kind === "tool" && block.call.diff).toEqual([
      { kind: "add", text: "# Hi" },
      { kind: "add", text: "there" },
    ]);
  });
});

describe("lineDiff", () => {
  it("keeps shared context and orders removals before additions", () => {
    expect(lineDiff("a\nb\nc\nd", "a\nB\nc\nd\ne")).toEqual([
      { kind: "context", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "context", text: "c" },
      { kind: "context", text: "d" },
      { kind: "add", text: "e" },
    ]);
  });

  it("handles empty sides and identical input", () => {
    expect(lineDiff("", "")).toEqual([]);
    expect(lineDiff("x", "")).toEqual([{ kind: "remove", text: "x" }]);
    expect(lineDiff("x\ny", "x\ny").every((l) => l.kind === "context")).toBe(
      true,
    );
  });

  it("falls back to a plain swap for huge rewrites", () => {
    const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join(
      "\n",
    );
    const after = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join("\n");
    const diff = lineDiff(before, after);
    expect(diff).toHaveLength(6000);
    expect(diff[0].kind).toBe("remove");
    expect(diff[5999].kind).toBe("add");
  });
});

const page = (
  entries: TranscriptEntry[],
  startOffset: number,
  nextOffset: number,
  reset = false,
): TranscriptPage => ({
  entries,
  startOffset,
  nextOffset,
  size: nextOffset,
  reset,
});

describe("TranscriptBuffer", () => {
  it("tracks offsets across tail, forward and backward pages", () => {
    const buffer = new TranscriptBuffer();
    expect(buffer.append(page([prompt("u2", "b")], 100, 200))).toBe(true);
    expect(buffer.startOffset).toBe(100);
    expect(buffer.append(page([], 200, 200))).toBe(false);
    expect(buffer.append(page([prompt("u3", "c")], 200, 300))).toBe(true);
    expect(buffer.canLoadEarlier).toBe(true);
    expect(buffer.prepend(page([prompt("u1", "a")], 0, 100))).toBe(true);
    expect(buffer.entries.map((e) => e.uuid)).toEqual(["u1", "u2", "u3"]);
    expect(buffer.canLoadEarlier).toBe(false);
  });

  it("drops the oldest entries past the caps and resets on a shrunken file", () => {
    const buffer = new TranscriptBuffer(3, 1_000_000);
    buffer.append(
      page(
        ["a", "b", "c", "d", "e"].map((u) => prompt(u, u)),
        0,
        50,
      ),
    );
    expect(buffer.entries.map((e) => e.uuid)).toEqual(["c", "d", "e"]);
    expect(buffer.truncated).toBe(true);

    const bytes = new TranscriptBuffer(100, 400);
    bytes.append(
      page(
        [prompt("big", "x".repeat(300)), prompt("next", "y".repeat(300))],
        0,
        10,
      ),
    );
    expect(bytes.entries.map((e) => e.uuid)).toEqual(["next"]);

    buffer.append(page([prompt("z", "z")], 0, 5, true));
    expect(buffer.entries.map((e) => e.uuid)).toEqual(["z"]);
    expect(buffer.truncated).toBe(false);
  });
});

describe("stripAnsi", () => {
  it("drops the colours Claude puts in slash command output", () => {
    expect(stripAnsi("Set model to \u001b[1mFable 5\u001b[22m and saved")).toBe(
      "Set model to Fable 5 and saved",
    );
    expect(
      stripAnsi("\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m"),
    ).toBe("Compacted (ctrl+o to see full summary)");
    expect(stripAnsi("\u001b]8;;https://x.y\u0007link\u001b]8;;\u0007")).toBe(
      "link",
    );
  });
});

describe("shell commands run with !", () => {
  const user = (uuid: string, content: string): TranscriptEntry => ({
    kind: "user",
    uuid,
    timestamp: "2026-11-05T10:00:00Z",
    blocks: [{ type: "text", text: content }],
  });

  it("shows the command as the prompt and its output under it, no raw tags", () => {
    const doc = buildDocument([
      user("u1", "<bash-input> gcloud auth login</bash-input>"),
      user(
        "u2",
        "<bash-stdout>Your browser has been opened to visit:\n\n    https://x.y/?a=1&amp;b=2</bash-stdout><bash-stderr>\u001b[33mwarning\u001b[0m</bash-stderr>",
      ),
    ]);
    expect(doc.turns).toHaveLength(1);
    expect(doc.turns[0].command).toBe("!gcloud auth login");
    expect(doc.turns[0].prompt).toBeNull();
    expect(doc.turns[0].blocks).toEqual([
      {
        kind: "notice",
        id: expect.any(String),
        text: "Your browser has been opened to visit:\n\n    https://x.y/?a=1&b=2\nwarning",
      },
    ]);
  });

  it("drops empty output", () => {
    const doc = buildDocument([
      user("u1", "<bash-input>true</bash-input>"),
      user("u2", "<bash-stdout></bash-stdout><bash-stderr></bash-stderr>"),
    ]);
    expect(doc.turns[0].blocks).toEqual([]);
    expect(shellOutput("plain text")).toBeNull();
  });
});

describe("background task notifications", () => {
  it("become a one-line notice, not a raw prompt", () => {
    const doc = buildDocument([
      {
        kind: "user",
        uuid: "n1",
        blocks: [
          {
            type: "text",
            text: '<task-notification>\n<task-id>b6</task-id>\n<status>completed</status>\n<summary>Background command "Probe search model" completed (exit code 0)</summary>\n</task-notification>',
          },
        ],
      },
    ]);
    expect(doc.turns[0].prompt).toBeNull();
    expect(doc.turns[0].blocks[0]).toMatchObject({
      kind: "notice",
      text: 'Background command "Probe search model" completed (exit code 0)',
    });
    expect(taskNotice("hello")).toBeNull();
  });
});

describe("pasted text", () => {
  it("drops Claude Code's <pasted_content> tags, with or without an id", () => {
    expect(
      pastedSpans('\n\n<pasted_content id="9f5a">\nA & B\n</pasted_content id="9f5a">\nwhy?'),
    ).toEqual({ text: "\n\n\n\nA & B\n\n\nwhy?", pastes: ["A & B"] });
    expect(pastedSpans("<pasted_content>x</pasted_content> y").pastes).toEqual(["x"]);
  });

  it("runs a paste whose closing tag was cut off to the end", () => {
    expect(pastedSpans('ask <pasted_content id="1">long text')).toEqual({
      text: "ask \n\nlong text\n\n",
      pastes: ["long text"],
    });
  });

  it("shows a prompt with two pastes clean, the pastes kept apart", () => {
    const doc = buildDocument([
      prompt(
        "u1",
        '<pasted_content id="a">\n  │ one\n</pasted_content id="a">\nand\n<pasted_content id="b">two</pasted_content id="b">',
      ),
    ]);
    const turn = doc.turns[0];
    expect(turn.prompt).toBe("  │ one\n\nand\n\ntwo");
    expect(turn.prompt).not.toContain("pasted_content");
    expect(turn.pastes).toEqual(["  │ one", "two"]);
  });
});
