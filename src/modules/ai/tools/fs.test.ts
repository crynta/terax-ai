import type { ToolExecutionOptions } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import type { ToolContext } from "./context";

const nativeMock = vi.hoisted(() => ({
  canonicalize: vi.fn(async (path: string) => path),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDir: vi.fn(),
}));
vi.mock("../lib/native", () => ({ native: nativeMock }));

import { usePlanStore } from "../store/planStore";
import { buildFsTools } from "./fs";

const options: ToolExecutionOptions = { toolCallId: "write", messages: [] };
const context: ToolContext = {
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

async function queueWrite() {
  const execute = buildFsTools(context).write_file.execute;
  if (!execute) throw new Error("missing write tool");
  return execute(
    { path: "/workspace/file.txt", content: "replacement" },
    options,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlanStore.setState({ active: true, queue: [] });
});

it.each([
  "AI path is outside the authorized workspace",
  "Permission denied (os error 13)",
  new Error("snapshot failed"),
])("does not queue an overwrite when the snapshot fails: %s", async (error) => {
  nativeMock.readFile.mockRejectedValue(error);
  expect(await queueWrite()).toMatchObject({ error: String(error) });
  expect(usePlanStore.getState().queue).toEqual([]);
  await usePlanStore.getState().applyAll();
  expect(nativeMock.writeFile).not.toHaveBeenCalled();
});

it.each([
  { kind: "binary", size: 20 },
  { kind: "toolarge", size: 100, limit: 10 },
])("does not queue an unreadable $kind snapshot", async (result) => {
  nativeMock.readFile.mockResolvedValue(result);
  expect(await queueWrite()).toHaveProperty("error");
  expect(usePlanStore.getState().queue).toEqual([]);
});

it("keeps a known missing file creatable in plan mode", async () => {
  nativeMock.readFile.mockRejectedValue("AI file not found");
  expect(await queueWrite()).toMatchObject({ queued_for_plan_review: true });
  expect(usePlanStore.getState().queue[0]).toMatchObject({
    originalContent: "",
    proposedContent: "replacement",
    isNewFile: true,
  });
});

it.each(["original", ""])(
  "preserves an existing snapshot, including empty files",
  async (content) => {
    nativeMock.readFile.mockResolvedValue({
      kind: "text",
      content,
      size: content.length,
    });
    expect(await queueWrite()).toMatchObject({ queued_for_plan_review: true });
    expect(usePlanStore.getState().queue[0]).toMatchObject({
      originalContent: content,
      proposedContent: "replacement",
      isNewFile: false,
    });
  },
);
