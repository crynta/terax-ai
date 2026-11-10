import { describe, expect, it } from "vitest";
import { pendingDetails, pendingToolCall } from "./pendingTool";
import type { ReaderDocument, ToolCall } from "./transcript";

function call(
  name: string,
  input: unknown,
  status: ToolCall["status"] = "running",
): ToolCall {
  return {
    id: `${name}-1`,
    name,
    input,
    status,
    result: null,
    filePath: null,
    diff: null,
    stdout: null,
    stderr: null,
    interrupted: false,
    children: [],
    timestamp: null,
  };
}

function doc(...calls: ToolCall[]): ReaderDocument {
  return {
    title: null,
    turns: [
      {
        id: "t1",
        prompt: "go",
        command: null,
        promptAt: null,
        images: [],
        blocks: calls.map((c) => ({
          kind: "tool" as const,
          id: c.id,
          call: c,
        })),
      },
    ],
  };
}

describe("pendingToolCall", () => {
  it("returns the last tool call when it has no result yet", () => {
    const bash = call("Bash", { command: "ls" });
    expect(pendingToolCall(doc(call("Read", {}, "done"), bash))).toBe(bash);
  });

  it("returns null when the newest call already finished", () => {
    expect(pendingToolCall(doc(call("Bash", {}, "done")))).toBeNull();
    expect(pendingToolCall({ title: null, turns: [] })).toBeNull();
  });
});

describe("pendingDetails", () => {
  it("shows a Bash call's command and description", () => {
    expect(
      pendingDetails(
        call("Bash", { command: "git push", description: "Push branch" }),
      ),
    ).toEqual({
      kind: "command",
      command: "git push",
      description: "Push branch",
    });
  });

  it("turns Edit, MultiEdit and Write inputs into a diff", () => {
    const edit = pendingDetails(
      call("Edit", {
        file_path: "/r/a.ts",
        old_string: "a\nb",
        new_string: "a\nc",
      }),
    );
    expect(edit.kind).toBe("edit");
    if (edit.kind !== "edit") throw new Error("edit");
    expect(edit.path).toBe("/r/a.ts");
    expect(
      edit.diff.filter((l) => l.kind !== "context").map((l) => l.text),
    ).toEqual(["b", "c"]);

    const write = pendingDetails(
      call("Write", { file_path: "/r/b.md", content: "x\ny" }),
    );
    if (write.kind !== "edit") throw new Error("write");
    expect(write.diff.every((l) => l.kind === "add")).toBe(true);

    const multi = pendingDetails(
      call("MultiEdit", {
        file_path: "/r/c.ts",
        edits: [
          { old_string: "1", new_string: "2" },
          { old_string: "3", new_string: "4" },
        ],
      }),
    );
    if (multi.kind !== "edit") throw new Error("multi");
    expect(multi.diff).toHaveLength(4);
  });

  it("caps a long diff and counts the rest", () => {
    const content = Array.from({ length: 450 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const d = pendingDetails(
      call("Write", { file_path: "/r/big.txt", content }),
    );
    if (d.kind !== "edit") throw new Error("edit");
    expect(d.diff).toHaveLength(400);
    expect(d.more).toBe(50);
  });

  it("summarises any other tool's input", () => {
    expect(
      pendingDetails(
        call("WebFetch", { url: "https://x.dev", prompt: "read it" }),
      ),
    ).toEqual({
      kind: "other",
      name: "WebFetch",
      summary: "url: https://x.dev\nprompt: read it",
    });
  });
});
