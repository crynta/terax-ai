import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

vi.mock("../lib/security", () => ({
  checkWritableCanonical: vi.fn(async (path: string) => ({
    ok: true as const,
    canonical: path,
  })),
}));

vi.mock("../store/planStore", () => ({
  newQueuedEditId: () => "queued-edit",
  usePlanStore: { getState: () => ({ active: false, enqueue: vi.fn() }) },
}));

import { buildEditTools } from "./edit";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

const FILE = "/workspace/a.txt";

function makeContext(readCache: Map<string, { size: number; hash: number }>) {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache,
    getSessionId: () => "session",
  } as unknown as ToolContext;
}

/** Context with the file already marked as read, satisfying read-before-edit. */
function readContext() {
  return makeContext(new Map([[FILE, { size: 0, hash: 0 }]]));
}

function setFile(content: string) {
  nativeMock.readFile.mockResolvedValue({
    kind: "text",
    content,
    size: content.length,
  });
}

type EditResult = { error?: string; replacements?: number };

async function runEdit(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<EditResult> {
  const execute = buildEditTools(ctx).edit.execute;
  if (!execute) throw new Error("edit tool has no execute");
  return (await execute(input as never, toolOptions)) as unknown as EditResult;
}

async function runMultiEdit(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<EditResult> {
  const execute = buildEditTools(ctx).multi_edit.execute;
  if (!execute) throw new Error("multi_edit tool has no execute");
  return (await execute(input as never, toolOptions)) as unknown as EditResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  nativeMock.canonicalize.mockImplementation(async (p: string) => p);
  nativeMock.writeFile.mockResolvedValue(undefined);
});

describe("edit tool guards", () => {
  it("refuses to edit a file that was never read (read-before-edit)", async () => {
    setFile("hello world");
    const result = await runEdit(makeContext(new Map()), {
      path: FILE,
      old_string: "hello",
      new_string: "bye",
    });
    expect(result.error).toContain("read_file");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("errors when old_string is absent", async () => {
    setFile("hello world");
    const result = await runEdit(readContext(), {
      path: FILE,
      old_string: "missing",
      new_string: "x",
    });
    expect(result.error).toContain("not found");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("errors when old_string is not unique and replace_all is off", async () => {
    setFile("a a");
    const result = await runEdit(readContext(), {
      path: FILE,
      old_string: "a",
      new_string: "b",
    });
    expect(result.error).toContain("not unique");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("rejects an identical old and new string", async () => {
    setFile("hello");
    const result = await runEdit(readContext(), {
      path: FILE,
      old_string: "hello",
      new_string: "hello",
    });
    expect(result.error).toContain("identical");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("rejects an empty old_string", async () => {
    setFile("hello");
    const result = await runEdit(readContext(), {
      path: FILE,
      old_string: "",
      new_string: "x",
    });
    expect(result.error).toContain("empty");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("refuses binary and oversized files", async () => {
    nativeMock.readFile.mockResolvedValue({ kind: "binary", size: 10 });
    const binary = await runEdit(readContext(), {
      path: FILE,
      old_string: "a",
      new_string: "b",
    });
    expect(binary.error).toContain("binary");

    nativeMock.readFile.mockResolvedValue({
      kind: "toolarge",
      size: 999,
      limit: 10,
    });
    const large = await runEdit(readContext(), {
      path: FILE,
      old_string: "a",
      new_string: "b",
    });
    expect(large.error).toContain("too large");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });
});

describe("edit tool replacement", () => {
  it("writes the file with a single unique replacement", async () => {
    setFile("hello world");
    const result = await runEdit(readContext(), {
      path: FILE,
      old_string: "world",
      new_string: "there",
    });
    expect(result.replacements).toBe(1);
    expect(nativeMock.writeFile).toHaveBeenCalledWith(FILE, "hello there");
  });

  it("replaces every occurrence and counts them with replace_all", async () => {
    setFile("a b a b a");
    const result = await runEdit(readContext(), {
      path: FILE,
      old_string: "a",
      new_string: "z",
      replace_all: true,
    });
    expect(result.replacements).toBe(3);
    expect(nativeMock.writeFile).toHaveBeenCalledWith(FILE, "z b z b z");
  });
});

describe("multi_edit atomicity", () => {
  it("applies edits in order against the running buffer", async () => {
    setFile("one two");
    const result = await runMultiEdit(readContext(), {
      path: FILE,
      edits: [
        { old_string: "one", new_string: "1" },
        { old_string: "two", new_string: "2" },
      ],
    });
    expect(result.replacements).toBe(2);
    expect(nativeMock.writeFile).toHaveBeenCalledWith(FILE, "1 2");
  });

  it("writes nothing when a later edit in the batch fails", async () => {
    setFile("one two");
    const result = await runMultiEdit(readContext(), {
      path: FILE,
      edits: [
        { old_string: "one", new_string: "1" },
        { old_string: "absent", new_string: "x" },
      ],
    });
    expect(result.error).toContain("not found");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("writes nothing when a later edit is non-unique", async () => {
    setFile("one dup dup");
    const result = await runMultiEdit(readContext(), {
      path: FILE,
      edits: [
        { old_string: "one", new_string: "1" },
        { old_string: "dup", new_string: "x" },
      ],
    });
    expect(result.error).toContain("not unique");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });
});
