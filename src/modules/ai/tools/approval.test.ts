import type { ToolExecutionOptions } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ToolContext } from "./context";
import { gateApproval } from "./context";

// Real security.ts (deny-lists) is intentionally NOT mocked: these tests
// assert that bypass leaves the deny-lists in charge. Only the native bridge
// and side-effecting stores are stubbed.
const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
  writeFile: vi.fn(async () => undefined),
  createDir: vi.fn(async () => undefined),
  shellSessionOpen: vi.fn(async () => 1),
  shellSessionRun: vi.fn(),
  shellBgSpawn: vi.fn(async () => 7),
  shellBgLogs: vi.fn(),
  shellBgList: vi.fn(),
  shellBgKill: vi.fn(async () => undefined),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

vi.mock("../store/planStore", () => ({
  newQueuedEditId: () => "queued-edit",
  usePlanStore: { getState: () => ({ active: false, enqueue: vi.fn() }) },
}));

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
  workspaceScopeKey: () => "local",
}));

vi.mock("@/modules/terminal", () => ({
  writeToSession: vi.fn(() => true),
}));

vi.mock("@/modules/agents/store/managedAgentsStore", () => ({
  useManagedAgentsStore: {
    getState: () => ({
      getBySessionId: () => undefined,
      get: () => undefined,
      remove: vi.fn(),
      bumpRound: vi.fn(),
    }),
  },
}));

import { buildEditTools } from "./edit";
import { buildFsTools } from "./fs";
import { buildManagedAgentTools } from "./agent";
import { buildShellTools } from "./shell";

const ctxStub: ToolContext = {
  getCwd: () => "/workspace",
  getWorkspaceRoot: () => "/workspace",
  getTerminalContext: () => null,
  isActiveTerminalPrivate: () => false,
  injectIntoActivePty: () => false,
  openPreview: () => false,
  spawnAgent: () => null,
  readAgentOutput: () => null,
  readCache: new Map(),
  getSessionId: () => "session-1",
};

const toolOptions: ToolExecutionOptions = {
  toolCallId: "tool-call",
  messages: [],
};

// The AI SDK's tool() execute takes (input, options); our impls ignore options.
const run = (fn: unknown, input: unknown): Promise<{ error?: string }> =>
  (fn as (i: unknown, o: unknown) => Promise<{ error?: string }>)(input, {});

// Mirrors the AI SDK's resolution: a boolean is used as-is; a function is
// evaluated per invocation with the tool input; absent means no approval.
type NeedsApprovalFn = (
  input: unknown,
  options: ToolExecutionOptions,
) => boolean | Promise<boolean>;

async function requiresApproval(
  tool: object,
  input: unknown,
): Promise<boolean> {
  const na = (tool as { needsApproval?: boolean | NeedsApprovalFn })
    .needsApproval;
  if (typeof na === "function") return na(input, toolOptions);
  return na === true;
}

beforeEach(() => {
  usePreferencesStore.setState({ aiBypassPermissions: false });
  nativeMock.writeFile.mockClear();
  nativeMock.shellSessionRun.mockClear();
  nativeMock.shellBgSpawn.mockClear();
});

describe("gateApproval", () => {
  it("requires approval by default (bypass off)", () => {
    expect(gateApproval(true)).toBe(true);
  });

  it("skips approval when bypass is enabled", () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    expect(gateApproval(true)).toBe(false);
  });

  it("never turns a non-gated tool into an approval request", () => {
    expect(gateApproval(false)).toBe(false);
    usePreferencesStore.setState({ aiBypassPermissions: true });
    expect(gateApproval(false)).toBe(false);
  });
});

describe("per-tool approval under the live pref", () => {
  const shellTools = () => buildShellTools(ctxStub);
  const fsTools = () => buildFsTools(ctxStub);
  const editTools = () => buildEditTools(ctxStub);

  it("default (bypass off): shell, fs-write and edit tools require approval", async () => {
    const shell = shellTools();
    const fs = fsTools();
    const edit = editTools();
    expect(await requiresApproval(shell.bash_run, { command: "ls" })).toBe(
      true,
    );
    expect(
      await requiresApproval(shell.bash_background, { command: "ls" }),
    ).toBe(true);
    expect(
      await requiresApproval(fs.write_file, { path: "/tmp/a", content: "x" }),
    ).toBe(true);
    expect(
      await requiresApproval(fs.create_directory, { path: "/tmp/d" }),
    ).toBe(true);
    expect(
      await requiresApproval(edit.edit, {
        path: "/tmp/a",
        old_string: "a",
        new_string: "b",
      }),
    ).toBe(true);
    expect(
      await requiresApproval(edit.multi_edit, {
        path: "/tmp/a",
        edits: [{ old_string: "a", new_string: "b" }],
      }),
    ).toBe(true);
  });

  it("bypass on: shell, fs-write and edit tools skip the approval prompt", async () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    const shell = shellTools();
    const fs = fsTools();
    const edit = editTools();
    expect(await requiresApproval(shell.bash_run, { command: "ls" })).toBe(
      false,
    );
    expect(
      await requiresApproval(shell.bash_background, { command: "ls" }),
    ).toBe(false);
    expect(
      await requiresApproval(fs.write_file, { path: "/tmp/a", content: "x" }),
    ).toBe(false);
    expect(
      await requiresApproval(fs.create_directory, { path: "/tmp/d" }),
    ).toBe(false);
    expect(
      await requiresApproval(edit.edit, {
        path: "/tmp/a",
        old_string: "a",
        new_string: "b",
      }),
    ).toBe(false);
    expect(
      await requiresApproval(edit.multi_edit, {
        path: "/tmp/a",
        edits: [{ old_string: "a", new_string: "b" }],
      }),
    ).toBe(false);
  });

  it("toggle is live: the same tool object follows the pref on each call", async () => {
    const shell = shellTools();
    expect(await requiresApproval(shell.bash_run, { command: "ls" })).toBe(
      true,
    );
    usePreferencesStore.setState({ aiBypassPermissions: true });
    expect(await requiresApproval(shell.bash_run, { command: "ls" })).toBe(
      false,
    );
    usePreferencesStore.setState({ aiBypassPermissions: false });
    expect(await requiresApproval(shell.bash_run, { command: "ls" })).toBe(
      true,
    );
  });

  it("spawn_coding_agent and send_to_agent stay pinned to approval, bypass on or off", async () => {
    const agent = buildManagedAgentTools(ctxStub);
    expect(agent.spawn_coding_agent.needsApproval).toBe(true);
    expect(agent.send_to_agent.needsApproval).toBe(true);
    expect(
      await requiresApproval(agent.spawn_coding_agent, { prompt: "x" }),
    ).toBe(true);
    expect(
      await requiresApproval(agent.send_to_agent, { instruction: "x" }),
    ).toBe(true);

    usePreferencesStore.setState({ aiBypassPermissions: true });
    expect(
      await requiresApproval(agent.spawn_coding_agent, { prompt: "x" }),
    ).toBe(true);
    expect(
      await requiresApproval(agent.send_to_agent, { instruction: "x" }),
    ).toBe(true);
  });
});

// The security invariant: bypass only drops the approval prompt. The deny-list
// in each tool's execute must still reject, otherwise a destructive command
// would auto-run. Each assertion also checks the native bridge was never
// reached, so a refusal is proven to happen before any side effect.
describe("bypass never weakens the deny-lists", () => {
  it("bash_run still refuses 'rm -rf /' with bypass ON", async () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    const tools = buildShellTools(ctxStub);
    const res = await run(tools.bash_run.execute, { command: "rm -rf /" });
    expect(res.error).toContain("filesystem root");
    expect(nativeMock.shellSessionRun).not.toHaveBeenCalled();
  });

  it("bash_background still refuses a fork bomb with bypass ON", async () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    const tools = buildShellTools(ctxStub);
    const res = await run(tools.bash_background.execute, {
      command: ":(){ :|:& };:",
    });
    expect(res.error).toContain("fork-bomb");
    expect(nativeMock.shellBgSpawn).not.toHaveBeenCalled();
  });

  it("write_file still refuses a write under /etc with bypass ON", async () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    const tools = buildFsTools(ctxStub);
    const res = await run(tools.write_file.execute, {
      path: "/etc/passwd",
      content: "x",
    });
    expect(res.error).toMatch(/^Refused:/);
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });

  it("edit still refuses a write under /etc with bypass ON", async () => {
    usePreferencesStore.setState({ aiBypassPermissions: true });
    const tools = buildEditTools(ctxStub);
    const res = await run(tools.edit.execute, {
      path: "/etc/hosts",
      old_string: "a",
      new_string: "b",
    });
    expect(res.error).toMatch(/^Refused:/);
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
  });
});
