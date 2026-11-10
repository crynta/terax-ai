import { describe, expect, it } from "vitest";
import type { ReaderBlock, ReaderTurn, ToolCall } from "./transcript";
import {
  bashOutput,
  compactDiff,
  diffStats,
  displayPath,
  formatDuration,
  groupReaderBlocks,
  mcpName,
  numberDiff,
  todoItems,
  toolKind,
  toolTitle,
  turnOutcome,
} from "./readerView";

function call(
  name: string,
  input: unknown,
  over: Partial<ToolCall> = {},
): ToolCall {
  return {
    id: `${name}-${Math.random()}`,
    name,
    input,
    status: "done",
    result: null,
    filePath: null,
    diff: null,
    stdout: null,
    stderr: null,
    interrupted: false,
    children: [],
    timestamp: null,
    ...over,
  };
}

const tool = (c: ToolCall): ReaderBlock => ({
  kind: "tool",
  id: c.id,
  call: c,
});

describe("toolKind / mcpName", () => {
  it("maps Claude tool names to card kinds", () => {
    expect(toolKind("Bash")).toBe("bash");
    expect(toolKind("MultiEdit")).toBe("edit");
    expect(toolKind("Glob")).toBe("search");
    expect(toolKind("Task")).toBe("task");
    expect(toolKind("TodoWrite")).toBe("todo");
    expect(toolKind("mcp__plugin_ucl_ucl__github_search_code")).toBe("mcp");
    expect(toolKind("Unknown")).toBe("other");
  });

  it("names MCP tools by server and tool", () => {
    expect(mcpName("mcp__plugin_ucl_ucl__github_search_code")).toEqual({
      server: "ucl",
      tool: "github search code",
    });
    expect(mcpName("mcp__meeupp__airflow_dags")).toEqual({
      server: "meeupp",
      tool: "airflow dags",
    });
  });
});

describe("toolTitle", () => {
  it("shows the first line of a command, marked when it continues", () => {
    expect(toolTitle(call("Bash", { command: "ls -la" }), null)).toMatchObject({
      label: "Ran",
      detail: "ls -la",
      mono: true,
    });
    expect(
      toolTitle(call("Bash", { command: "cd x\nmake" }), null).detail,
    ).toBe("cd x …");
  });

  it("shows file paths relative to the session folder or home", () => {
    const title = toolTitle(
      call(
        "Edit",
        { file_path: "/repo/src/a.ts" },
        { filePath: "/repo/src/a.ts" },
      ),
      "/repo",
    );
    expect(title).toMatchObject({
      label: "Edited",
      detail: "src/a.ts",
      path: "/repo/src/a.ts",
    });
    expect(displayPath("/Users/me/x.md", "/repo", "/Users/me")).toBe("~/x.md");
    expect(displayPath("/etc/hosts", "/repo")).toBe("/etc/hosts");
  });

  it("shows search patterns and subagent descriptions", () => {
    expect(
      toolTitle(call("Grep", { pattern: "foo", path: "/repo/src" }), "/repo")
        .detail,
    ).toBe("foo in src");
    expect(
      toolTitle(call("Task", { description: "Scan repo" }), null),
    ).toMatchObject({
      label: "Subagent",
      detail: "Scan repo",
    });
  });
});

describe("diff helpers", () => {
  const diff = numberDiff([
    { kind: "context", text: "a" },
    { kind: "remove", text: "b" },
    { kind: "add", text: "B" },
    { kind: "add", text: "C" },
    { kind: "context", text: "d" },
  ]);

  it("numbers each side and counts changes", () => {
    expect(diff.map((l) => [l.oldNo, l.newNo])).toEqual([
      [1, 1],
      [2, null],
      [null, 2],
      [null, 3],
      [3, 4],
    ]);
    expect(diffStats(diff)).toEqual({ added: 2, removed: 1 });
  });

  it("collapses unchanged lines far from any change", () => {
    const long = numberDiff([
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: "context" as const,
        text: `c${i}`,
      })),
      { kind: "add", text: "new" },
      ...Array.from({ length: 10 }, (_, i) => ({
        kind: "context" as const,
        text: `d${i}`,
      })),
    ]);
    const compact = compactDiff(long, 2);
    expect(compact[0]).toEqual({ kind: "gap", hidden: 8 });
    expect(compact.filter((l) => l.kind !== "gap")).toHaveLength(5);
    expect(compact[compact.length - 1]).toEqual({ kind: "gap", hidden: 8 });
  });
});

describe("groupReaderBlocks", () => {
  it("folds three or more consecutive reads and searches", () => {
    const blocks = [
      tool(call("Read", {})),
      tool(call("Grep", {})),
      { kind: "thinking", id: "k", text: "", durationMs: 100 } as ReaderBlock,
      tool(call("Glob", {})),
      tool(call("Bash", { command: "ls" })),
    ];
    const items = groupReaderBlocks(blocks);
    expect(items.map((i) => i.kind)).toEqual(["explore", "block"]);
    expect(items[0].kind === "explore" && items[0].calls).toHaveLength(3);
  });

  it("keeps short runs as individual cards", () => {
    const items = groupReaderBlocks([
      tool(call("Read", {})),
      tool(call("Bash", {})),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["block", "block"]);
  });
});

describe("turn and misc helpers", () => {
  const turn = (blocks: ReaderBlock[]): ReaderTurn => ({
    id: "t",
    prompt: "p",
    command: null,
    promptAt: null,
    images: [],
    blocks,
  });

  it("derives the turn outcome from its tool calls", () => {
    expect(
      turnOutcome(turn([tool(call("Bash", {}, { status: "running" }))])),
    ).toBe("running");
    expect(
      turnOutcome(turn([tool(call("Bash", {}, { status: "error" }))])),
    ).toBe("error");
    expect(turnOutcome(turn([]))).toBe("done");
  });

  it("formats durations compactly", () => {
    expect(formatDuration(400)).toBe("1s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
  });

  it("reads TodoWrite items and Bash output", () => {
    expect(
      todoItems({
        todos: [
          { content: "a", status: "completed" },
          { content: "b", status: "in_progress" },
          { activeForm: "c" },
          { content: "" },
        ],
      }),
    ).toEqual([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" },
    ]);
    expect(bashOutput({ stdout: "out", stderr: null, result: "x" })).toEqual({
      stdout: "out",
      stderr: "",
    });
    expect(bashOutput({ stdout: null, stderr: null, result: "raw" })).toEqual({
      stdout: "raw",
      stderr: "",
    });
  });
});
