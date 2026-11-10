import { describe, expect, it } from "vitest";
import {
  changedFiles,
  changesSummary,
  combinedDiff,
  parseUnifiedDiff,
  removedPaths,
  repoRelative,
  reviewPrompt,
} from "./changes";
import { codeBlockPath, resolveBlockPath } from "./codeBlockPath";
import { inFlightCall, liveTitle, turnSteps } from "./liveStream";
import { keepPlanningOption, latestPlan, latestTodos } from "./sessionPlan";
import type { ReaderBlock, ReaderDocument, ToolCall } from "./transcript";
import { compactItems } from "./viewMode";

let seq = 0;
function call(
  name: string,
  input: unknown,
  extra: Partial<ToolCall> = {},
): ToolCall {
  seq += 1;
  return {
    id: `c${seq}`,
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
    timestamp: `2026-11-04T10:00:${String(seq).padStart(2, "0")}Z`,
    ...extra,
  };
}
const tool = (c: ToolCall): ReaderBlock => ({
  kind: "tool",
  id: c.id,
  call: c,
});
const text = (t: string): ReaderBlock => ({
  kind: "text",
  id: `x${t}`,
  text: t,
});
function doc(...turns: ReaderBlock[][]): ReaderDocument {
  return {
    title: null,
    turns: turns.map((blocks, i) => ({
      id: `t${i}`,
      prompt: "p",
      command: null,
      promptAt: null,
      images: [],
      blocks,
    })),
  };
}

const CWD = "/repo";

describe("live stream", () => {
  it("finds the running call of the last turn, with a subagent's running step", () => {
    const inner = call(
      "Read",
      { file_path: "/repo/a.ts" },
      { status: "running" },
    );
    const task = call(
      "Task",
      { description: "Explore auth" },
      { status: "running", children: [tool(inner)] },
    );
    const d = doc(
      [tool(call("Bash", { command: "ls" }))],
      [tool(call("Read", { file_path: "/repo/b.ts" })), tool(task)],
    );
    const flight = inFlightCall(d);
    expect(flight?.call.id).toBe(task.id);
    expect(flight?.nested?.id).toBe(inner.id);
    expect(
      inFlightCall(doc([tool(call("Bash", { command: "ls" }))])),
    ).toBeNull();
    expect(inFlightCall({ title: null, turns: [] })).toBeNull();
  });

  it("titles in-flight calls in the present tense", () => {
    expect(liveTitle(call("Bash", { command: "pnpm test" }), CWD)).toEqual({
      verb: "Running",
      detail: "pnpm test",
      mono: true,
    });
    expect(
      liveTitle(call("Edit", {}, { filePath: "/repo/src/reader.css" }), CWD)
        .detail,
    ).toBe("reader.css");
    expect(liveTitle(call("Grep", { pattern: "foo" }), CWD)).toMatchObject({
      verb: "Searching",
      detail: "'foo'",
    });
    expect(
      liveTitle(call("Task", { description: "Explore the repo" }), CWD),
    ).toMatchObject({ verb: "Subagent", detail: "Explore the repo" });
  });

  it("lists the finished steps of a turn", () => {
    const turn = doc([
      tool(call("Read", {}, { filePath: "/repo/a.ts" })),
      text("hi"),
      tool(call("Bash", { command: "false" }, { status: "error" })),
      tool(call("Bash", { command: "sleep 9" }, { status: "running" })),
    ]).turns[0];
    const steps = turnSteps(turn, CWD);
    expect(steps.map((s) => [s.label, s.detail, s.error])).toEqual([
      ["Read", "a.ts", false],
      ["Ran", "false", true],
    ]);
  });
});

describe("todos and plans", () => {
  it("takes the latest TodoWrite state", () => {
    const d = doc(
      [
        tool(
          call("TodoWrite", {
            todos: [{ content: "old", status: "pending" }],
          }),
        ),
      ],
      [
        tool(
          call("TodoWrite", {
            todos: [
              { content: "a", status: "completed" },
              { content: "b", status: "in_progress" },
              { content: "c", status: "pending" },
            ],
          }),
        ),
      ],
    );
    const todos = latestTodos(d);
    expect(todos?.items.map((i) => i.content)).toEqual(["a", "b", "c"]);
    expect(todos).toMatchObject({ done: 1, total: 3, active: 1 });
  });

  it("builds a task list from TaskCreate and TaskUpdate after the last TodoWrite", () => {
    const d = doc([
      tool(call("TodoWrite", { todos: [{ content: "x", status: "pending" }] })),
      tool(
        call(
          "TaskCreate",
          { subject: "Write parser" },
          {
            result: "Task #1 created successfully: Write parser",
          },
        ),
      ),
      tool(
        call(
          "TaskCreate",
          { subject: "Add tests" },
          {
            result: "Task #2 created successfully: Add tests",
          },
        ),
      ),
      tool(call("TaskUpdate", { taskId: "1", status: "completed" })),
      tool(call("TaskUpdate", { taskId: "2", status: "in_progress" })),
    ]);
    const todos = latestTodos(d);
    expect(todos?.items).toEqual([
      { content: "Write parser", status: "completed" },
      { content: "Add tests", status: "in_progress" },
    ]);
    expect(todos?.active).toBe(1);
  });

  it("returns null without to-dos", () => {
    expect(latestTodos(doc([text("hi")]))).toBeNull();
  });

  it("finds the latest ExitPlanMode plan and its state", () => {
    const pending = call(
      "ExitPlanMode",
      { plan: "## Plan\n1. Do it" },
      { status: "running" },
    );
    expect(latestPlan(doc([tool(pending)]))).toMatchObject({
      markdown: "## Plan\n1. Do it",
      status: "running",
      rejected: false,
    });
    const rejected = call(
      "ExitPlanMode",
      { plan: "v2" },
      { result: "The user doesn't want to proceed with this tool use." },
    );
    expect(latestPlan(doc([tool(pending)], [tool(rejected)]))).toMatchObject({
      markdown: "v2",
      rejected: true,
    });
    expect(latestPlan(doc([text("no plan")]))).toBeNull();
  });

  it("picks the keep-planning option", () => {
    const options = [
      { n: 1, label: "Yes, and auto-accept edits", escape: false },
      { n: 2, label: "Yes, and manually approve edits", escape: false },
      { n: 3, label: "No, keep planning", escape: true },
    ];
    expect(keepPlanningOption(options)).toBe(3);
    expect(
      keepPlanningOption([{ n: 1, label: "Yes", escape: false }]),
    ).toBeNull();
  });
});

describe("changed files", () => {
  it("aggregates edits, writes and deletes per file", () => {
    const d = doc(
      [
        tool(
          call(
            "Write",
            {},
            {
              filePath: "/repo/new.ts",
              diff: [
                { kind: "add", text: "a" },
                { kind: "add", text: "b" },
              ],
            },
          ),
        ),
        tool(
          call(
            "Edit",
            {},
            {
              filePath: "/repo/src/a.ts",
              diff: [
                { kind: "remove", text: "x" },
                { kind: "add", text: "y" },
              ],
            },
          ),
        ),
      ],
      [
        tool(
          call(
            "Edit",
            {},
            {
              filePath: "/repo/src/a.ts",
              diff: [{ kind: "add", text: "z" }],
            },
          ),
        ),
        tool(call("Edit", {}, { filePath: "/repo/bad.ts", status: "error" })),
        tool(call("Bash", { command: "rm new.ts" })),
      ],
    );
    const files = changedFiles(d, CWD);
    const a = files.find((f) => f.path === "/repo/src/a.ts");
    const created = files.find((f) => f.path === "/repo/new.ts");
    expect(files.map((f) => f.path).sort()).toEqual([
      "/repo/new.ts",
      "/repo/src/a.ts",
    ]);
    expect(a).toMatchObject({ added: 2, removed: 1, edits: 2, created: false });
    expect(created).toMatchObject({ created: true, deleted: true, added: 2 });
    expect(combinedDiff(a ?? { diffs: [] }).map((l) => l.text)).toEqual([
      "x",
      "y",
      "⋯",
      "z",
    ]);
  });

  it("subagent edits count too", () => {
    const inner = call(
      "Edit",
      {},
      {
        filePath: "/repo/sub.ts",
        diff: [{ kind: "add", text: "q" }],
      },
    );
    const task = call("Task", {}, { children: [tool(inner)] });
    expect(changedFiles(doc([tool(task)]), CWD)[0]?.path).toBe("/repo/sub.ts");
  });

  it("only trusts plain rm commands", () => {
    expect(removedPaths("rm -f a.txt ./b/c.ts", "/repo")).toEqual([
      "/repo/a.txt",
      "/repo/b/c.ts",
    ]);
    expect(removedPaths("rm *.log", "/repo")).toEqual([]);
    expect(removedPaths("rm a && rm b", "/repo")).toEqual([]);
    expect(removedPaths("echo rm a", "/repo")).toEqual([]);
  });

  it("maps paths into the repo safely", () => {
    expect(repoRelative("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(repoRelative("/repo/src/a.ts", "/repo/")).toBe("src/a.ts");
    expect(repoRelative("/repository/x.ts", "/repo")).toBeNull();
    expect(repoRelative("/repo/../etc/passwd", "/repo")).toBeNull();
    expect(repoRelative("/elsewhere/a.ts", "/repo")).toBeNull();
  });

  it("builds the review prompt and summary", () => {
    const files = changedFiles(
      doc([
        tool(
          call(
            "Edit",
            {},
            {
              filePath: "/repo/src/a.ts",
              diff: [{ kind: "add", text: "y" }],
            },
          ),
        ),
      ]),
      CWD,
    );
    expect(reviewPrompt(files, CWD)).toContain("- src/a.ts");
    expect(changesSummary(files, CWD)).toContain(
      "1 file changed, +1 −0\n\n- `src/a.ts` +1 −0",
    );
  });

  it("parses a git diff into lines", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "@@ -9 +9 @@",
      "+tail",
    ].join("\n");
    expect(parseUnifiedDiff(diff)).toEqual([
      { kind: "context", text: "keep" },
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
      { kind: "context", text: "⋯" },
      { kind: "add", text: "tail" },
    ]);
  });
});

describe("code block paths", () => {
  it("reads a path from the info string or language", () => {
    expect(codeBlockPath("x", "ts", "title=src/a.ts")).toBe("src/a.ts");
    expect(codeBlockPath("x", "src/main.rs")).toBe("src/main.rs");
    expect(codeBlockPath("x", "ts")).toBeNull();
  });

  it("reads a first-line comment naming a path", () => {
    expect(codeBlockPath("// src/reader.css\nbody{}", "css")).toBe(
      "src/reader.css",
    );
    expect(codeBlockPath("# app/main.py\nprint()", "python")).toBe(
      "app/main.py",
    );
    expect(codeBlockPath("<!-- docs/index.html -->", "html")).toBe(
      "docs/index.html",
    );
    expect(codeBlockPath("// increment the counter", "ts")).toBeNull();
    expect(codeBlockPath("# https://example.com/a.py", "py")).toBeNull();
    expect(codeBlockPath("# notes.txt", "sh")).toBeNull();
  });

  it("resolves relative paths against the session folder", () => {
    expect(resolveBlockPath("src/a.ts", "/repo", "/home/me")).toBe(
      "/repo/src/a.ts",
    );
    expect(resolveBlockPath("~/x.md", "/repo", "/home/me")).toBe(
      "/home/me/x.md",
    );
    expect(resolveBlockPath("/abs/a.ts", "/repo", null)).toBe("/abs/a.ts");
  });
});

describe("compact view", () => {
  it("drops thinking and folds tool runs into steps", () => {
    const a = call("Read", {});
    const b = call("Bash", { command: "ls" });
    const c = call("Edit", {});
    const items = compactItems([
      text("intro"),
      { kind: "thinking", id: "th", text: "", durationMs: 3 },
      tool(a),
      tool(b),
      text("middle"),
      tool(c),
    ]);
    expect(
      items.map((i) => (i.kind === "steps" ? i.calls.length : "text")),
    ).toEqual(["text", 2, "text", 1]);
  });
});
