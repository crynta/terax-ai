import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const securityMock = vi.hoisted(() => ({
  checkShellCommand: vi.fn<
    (command: string) => { ok: true } | { ok: false; reason: string }
  >(() => ({ ok: true })),
}));

vi.mock("../lib/security", () => securityMock);

import { buildTerminalTools } from "./terminal";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

type Ctx = {
  isActiveTerminalPrivate?: () => boolean;
  getTerminalContext?: () => string | null;
  openPreview?: (url: string) => boolean;
};

function makeContext(over: Ctx = {}): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: over.getTerminalContext ?? (() => null),
    isActiveTerminalPrivate: over.isActiveTerminalPrivate ?? (() => false),
    injectIntoActivePty: () => false,
    openPreview: over.openPreview ?? (() => true),
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "session",
  } as unknown as ToolContext;
}

// biome-ignore lint/suspicious/noExplicitAny: tool results are heterogeneous.
type Result = Record<string, any>;

async function run(
  toolName: "suggest_command" | "get_terminal_output" | "open_preview",
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<Result> {
  const execute = buildTerminalTools(ctx)[toolName].execute;
  if (!execute) throw new Error(`${toolName} has no execute`);
  return (await execute(input as never, toolOptions)) as unknown as Result;
}

beforeEach(() => {
  vi.clearAllMocks();
  securityMock.checkShellCommand.mockReturnValue({ ok: true });
});

describe("suggest_command", () => {
  it("returns the command and explanation for a safe command", async () => {
    const r = await run("suggest_command", makeContext(), {
      command: "ls -la",
      explanation: "list files",
    });
    expect(r).toEqual({ command: "ls -la", explanation: "list files" });
  });

  it("refuses a command rejected by the shell guard", async () => {
    securityMock.checkShellCommand.mockReturnValue({
      ok: false,
      reason: "blocked",
    });
    expect(
      (await run("suggest_command", makeContext(), { command: "rm -rf /" }))
        .error,
    ).toContain("blocked");
  });

  it("rejects commands containing control bytes", async () => {
    const r = await run("suggest_command", makeContext(), {
      command: "echo a\nrm b",
    });
    expect(r.error).toContain("single line");
  });
});

describe("get_terminal_output", () => {
  it("refuses when the active terminal is in privacy mode", async () => {
    const r = await run(
      "get_terminal_output",
      makeContext({ isActiveTerminalPrivate: () => true }),
      {},
    );
    expect(r.error).toContain("Privacy mode");
  });

  it("returns an empty string when there is no active terminal", async () => {
    const r = await run("get_terminal_output", makeContext(), {});
    expect(r.output).toBe("");
    expect(r.note).toBe("no active terminal");
  });

  it("returns only the trailing N lines", async () => {
    const buffer = ["a", "b", "c", "d", "e"].join("\n");
    const r = await run(
      "get_terminal_output",
      makeContext({ getTerminalContext: () => buffer }),
      { lines: 2 },
    );
    expect(r.output).toBe("d\ne");
    expect(r.lines_returned).toBe(2);
  });

  it("caps a very long buffer at exactly 24,000 characters plus the notice", async () => {
    const buffer = "x".repeat(30_000);
    const r = await run(
      "get_terminal_output",
      makeContext({ getTerminalContext: () => buffer }),
      { lines: 1 },
    );
    const prefix = "…[truncated]…\n";
    expect(r.output.startsWith(prefix)).toBe(true);
    expect(r.output.length).toBe(prefix.length + 24_000);
    expect(r.output.slice(prefix.length)).toBe("x".repeat(24_000));
  });
});

describe("open_preview", () => {
  it("opens a loopback URL", async () => {
    const openPreview = vi.fn(() => true);
    const r = await run("open_preview", makeContext({ openPreview }), {
      url: "http://localhost:5173",
    });
    expect(r.ok).toBe(true);
    expect(openPreview).toHaveBeenCalledWith("http://localhost:5173");
  });

  it("accepts common loopback hosts", async () => {
    for (const url of [
      "http://127.0.0.1:3000",
      "http://[::1]:8080",
      "https://app.localhost/",
    ]) {
      const r = await run("open_preview", makeContext(), { url });
      expect(r.ok, url).toBe(true);
    }
  });

  it("rejects a non-loopback host", async () => {
    const openPreview = vi.fn(() => true);
    const r = await run("open_preview", makeContext({ openPreview }), {
      url: "http://example.com",
    });
    expect(r.error).toContain("localhost");
    expect(openPreview).not.toHaveBeenCalled();
  });

  it("rejects a non-http scheme", async () => {
    const r = await run("open_preview", makeContext(), {
      url: "file://localhost/etc/passwd",
    });
    expect(r.error).toContain("http/https");
  });

  it("reports when the preview surface is unavailable", async () => {
    const r = await run(
      "open_preview",
      makeContext({ openPreview: () => false }),
      {
        url: "http://localhost:5173",
      },
    );
    expect(r.error).toContain("unavailable");
  });
});
