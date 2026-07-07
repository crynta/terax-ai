import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  glob: vi.fn(),
  grep: vi.fn(),
}));

vi.mock("../lib/native", () => ({
  native: nativeMock,
}));

import { buildSearchTools } from "./search";

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

function makeContext(): ToolContext {
  return {
    getCwd: () => "/workspace",
    getWorkspaceRoot: () => "/workspace",
    getTerminalContext: () => null,
    isActiveTerminalPrivate: () => false,
    injectIntoActivePty: () => false,
    openPreview: () => false,
    spawnAgent: () => null,
    readAgentOutput: () => null,
    readCache: new Map(),
    getSessionId: () => "session",
  };
}

type GrepToolResult = {
  hits: { path: string; rel: string; line: number; text: string }[];
};

type GlobToolResult = {
  hits: { path: string; rel: string }[];
};

describe("AI search tools path safety", () => {
  beforeEach(() => {
    nativeMock.canonicalize.mockClear();
    nativeMock.glob.mockReset();
    nativeMock.grep.mockReset();
  });

  it("filters grep hits that read_file would refuse", async () => {
    nativeMock.grep.mockResolvedValue({
      hits: [
        {
          path: "/workspace/src/app.ts",
          rel: "workspace/src/app.ts",
          line: 7,
          text: "const tokenName = 'safe fixture';",
        },
        {
          path: "/workspace/secrets.json",
          rel: "workspace/secrets.json",
          line: 1,
          text: '{"token":"secret"}',
        },
        {
          path: "/workspace/server.pem",
          rel: "workspace/server.pem",
          line: 1,
          text: "BEGIN PRIVATE KEY",
        },
        {
          path: "/etc/passwd",
          rel: "etc/passwd",
          line: 1,
          text: "root:x:0:0:root:/root:/bin/sh",
        },
      ],
      truncated: false,
      files_scanned: 4,
    });

    const tools = buildSearchTools(makeContext());
    const execute = tools.grep.execute;
    if (!execute) throw new Error("grep tool execute missing");
    const result = (await execute(
      { pattern: "token|root|PRIVATE KEY", root: "/" },
      toolOptions,
    )) as GrepToolResult;

    expect(result.hits.map((h) => h.path)).toEqual(["/workspace/src/app.ts"]);
    expect(result.hits.map((h) => h.text)).toEqual([
      "const tokenName = 'safe fixture';",
    ]);
  });

  it("filters glob hits that enumerate sensitive paths", async () => {
    nativeMock.glob.mockResolvedValue({
      hits: [
        { path: "/home/me/project/src/index.ts", rel: "src/index.ts" },
        { path: "/home/me/project/id_rsa", rel: "id_rsa" },
        { path: "/home/me/project/.ssh/config", rel: ".ssh/config" },
        { path: "service-account-prod.json", rel: "service-account-prod.json" },
        { path: "/etc/passwd", rel: "../../etc/passwd" },
      ],
      truncated: false,
    });

    const tools = buildSearchTools(makeContext());
    const execute = tools.glob.execute;
    if (!execute) throw new Error("glob tool execute missing");
    const result = (await execute(
      { pattern: "**/*", root: "/home/me/project" },
      toolOptions,
    )) as GlobToolResult;

    expect(result.hits).toEqual([
      { path: "/home/me/project/src/index.ts", rel: "src/index.ts" },
    ]);
  });
});
