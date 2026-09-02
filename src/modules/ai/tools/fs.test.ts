import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  readDir: vi.fn(),
  createDir: vi.fn(async () => undefined),
}));

type SafetyCheck =
  | { ok: true; canonical: string }
  | { ok: false; reason: string };

const securityMock = vi.hoisted(() => ({
  checkReadableCanonical: vi.fn<(path: string) => Promise<SafetyCheck>>(
    async (path) => ({ ok: true, canonical: path }),
  ),
  checkWritableCanonical: vi.fn<(path: string) => Promise<SafetyCheck>>(
    async (path) => ({ ok: true, canonical: path }),
  ),
}));

const planMock = vi.hoisted(() => ({
  active: false,
  enqueue: vi.fn(),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));
vi.mock("../lib/security", () => securityMock);
vi.mock("../store/planStore", () => ({
  newQueuedEditId: () => "queued-id",
  usePlanStore: {
    getState: () => ({ active: planMock.active, enqueue: planMock.enqueue }),
  },
}));

import { buildFsTools } from "./fs";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

const FILE = "/workspace/a.txt";

function makeContext(
  readCache = new Map<string, { size: number; hash: number }>(),
): ToolContext {
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

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function run(
  toolName: "read_file" | "list_directory" | "write_file" | "create_directory",
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<Result> {
  const execute = buildFsTools(ctx)[toolName].execute;
  if (!execute) throw new Error(`${toolName} has no execute`);
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

function textFile(content: string) {
  nativeMock.readFile.mockResolvedValue({
    kind: "text",
    content,
    size: content.length,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  planMock.active = false;
  nativeMock.canonicalize.mockImplementation(async (p: string) => p);
  securityMock.checkReadableCanonical.mockImplementation(async (p: string) => ({
    ok: true as const,
    canonical: p,
  }));
  securityMock.checkWritableCanonical.mockImplementation(async (p: string) => ({
    ok: true as const,
    canonical: p,
  }));
});

describe("read_file", () => {
  it("returns file content and the line total", async () => {
    textFile("one\ntwo\nthree");
    const r = await run("read_file", makeContext(), { path: FILE });
    expect(r.content).toBe("one\ntwo\nthree");
    expect(r.total_lines).toBe(3);
  });

  it("refuses binary and oversized files", async () => {
    nativeMock.readFile.mockResolvedValue({ kind: "binary", size: 5 });
    expect(
      (await run("read_file", makeContext(), { path: FILE })).error,
    ).toContain("binary");

    nativeMock.readFile.mockResolvedValue({
      kind: "toolarge",
      size: 9,
      limit: 1,
    });
    expect(
      (await run("read_file", makeContext(), { path: FILE })).error,
    ).toContain("too large");
  });

  it("propagates a security refusal without reading", async () => {
    securityMock.checkReadableCanonical.mockResolvedValue({
      ok: false,
      reason: "path is not readable",
    });
    const r = await run("read_file", makeContext(), { path: FILE });
    expect(r.error).toContain("not readable");
    expect(nativeMock.readFile).not.toHaveBeenCalled();
  });

  it("reports unchanged on a second identical full read", async () => {
    textFile("stable");
    const ctx = makeContext();
    const first = await run("read_file", ctx, { path: FILE });
    expect(first.content).toBe("stable");
    const second = await run("read_file", ctx, { path: FILE });
    expect(second.unchanged).toBe(true);
    expect(second.content).toBeUndefined();
  });

  it("truncates a full read past the 2000-line cap", async () => {
    textFile(Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n"));
    const r = await run("read_file", makeContext(), { path: FILE });
    expect(r.truncated).toBe(true);
    expect(r.total_lines).toBe(2500);
    expect(r.content.split("\n").length).toBeLessThanOrEqual(2000);
  });

  it("windows by offset and limit", async () => {
    textFile("l0\nl1\nl2\nl3\nl4");
    const r = await run("read_file", makeContext(), {
      path: FILE,
      offset: 1,
      limit: 2,
    });
    expect(r.content).toBe("l1\nl2");
    expect(r.start_line).toBe(1);
    expect(r.end_line).toBe(3);
  });
});

describe("list_directory", () => {
  it("maps entries to name and kind", async () => {
    nativeMock.readDir.mockResolvedValue([
      { name: "a.txt", kind: "file", size: 1, mtime: 0 },
      { name: "sub", kind: "dir", size: 0, mtime: 0 },
    ]);
    const r = await run("list_directory", makeContext(), {
      path: "/workspace",
    });
    expect(r.entries).toEqual([
      { name: "a.txt", kind: "file" },
      { name: "sub", kind: "dir" },
    ]);
  });

  it("propagates a security refusal", async () => {
    securityMock.checkReadableCanonical.mockResolvedValue({
      ok: false,
      reason: "denied",
    });
    expect(
      (await run("list_directory", makeContext(), { path: "/x" })).error,
    ).toContain("denied");
    expect(nativeMock.readDir).not.toHaveBeenCalled();
  });
});

describe("write_file", () => {
  it("writes content and reports the UTF-8 byte count", async () => {
    const r = await run("write_file", makeContext(), {
      path: FILE,
      content: "café",
    });
    expect(r.ok).toBe(true);
    expect(r.bytesWritten).toBe(5);
    expect(nativeMock.writeFile).toHaveBeenCalledWith(FILE, "café");
  });

  it("queues instead of writing when plan mode is active", async () => {
    planMock.active = true;
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content: "",
      size: 0,
    });
    const r = await run("write_file", makeContext(), {
      path: FILE,
      content: "hello",
    });
    expect(r.queued_for_plan_review).toBe(true);
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
    expect(planMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "write_file",
        path: FILE,
        originalContent: "",
        proposedContent: "hello",
      }),
    );
  });

  it("propagates a security refusal without writing", async () => {
    securityMock.checkWritableCanonical.mockResolvedValue({
      ok: false,
      reason: "read-only path",
    });
    const r = await run("write_file", makeContext(), {
      path: FILE,
      content: "x",
    });
    expect(r.error).toContain("read-only");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });
});

describe("create_directory", () => {
  it("creates the directory", async () => {
    const r = await run("create_directory", makeContext(), {
      path: "/workspace/new",
    });
    expect(r.ok).toBe(true);
    expect(nativeMock.createDir).toHaveBeenCalledWith("/workspace/new");
  });

  it("queues instead of creating when plan mode is active", async () => {
    planMock.active = true;
    const r = await run("create_directory", makeContext(), {
      path: "/workspace/new",
    });
    expect(r.queued_for_plan_review).toBe(true);
    expect(nativeMock.createDir).not.toHaveBeenCalled();
    expect(planMock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "create_directory",
        path: "/workspace/new",
        isNewFile: true,
        description: "Create directory",
      }),
    );
  });

  it("propagates a security refusal without creating", async () => {
    securityMock.checkWritableCanonical.mockResolvedValue({
      ok: false,
      reason: "protected directory",
    });
    const r = await run("create_directory", makeContext(), {
      path: "/etc/new-dir",
    });
    expect(r.error).toContain("protected");
    expect(nativeMock.createDir).not.toHaveBeenCalled();
  });
});
