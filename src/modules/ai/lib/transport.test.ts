import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderKeys } from "./keyring";
import type { ToolContext } from "../tools/tools";

const { native, runAgentStream, currentWorkspaceEnv } = vi.hoisted(() => ({
  currentWorkspaceEnv: vi.fn(() => ({ kind: "local" })),
  native: {
    canonicalize: vi.fn(),
    readProjectMemory: vi.fn(),
    readFile: vi.fn(),
  },
  runAgentStream: vi.fn(),
}));
vi.mock("@/modules/workspace", () => ({ currentWorkspaceEnv }));
vi.mock("./native", () => ({ native }));
vi.mock("./agent", () => ({ runAgentStream }));
import { createContextAwareTransport } from "./transport";

async function send(root: string) {
  await createContextAwareTransport({
    getKeys: () => ({}) as ProviderKeys,
    toolContext: {} as ToolContext,
    getModelId: () => "test",
    getCustomInstructions: () => "",
    getAgentPersona: () => null,
    getLive: () => ({
      cwd: root,
      workspaceRoot: root,
      terminalPrivate: false,
      activeFile: null,
    }),
  }).sendMessages({ messages: [] });
  return runAgentStream.mock.calls[runAgentStream.mock.calls.length - 1]?.[0]
    .projectMemory;
}

describe("automatic project memory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentWorkspaceEnv.mockReturnValue({ kind: "local" });
    runAgentStream.mockResolvedValue({ toUIMessageStream: () => null });
    native.readFile.mockResolvedValue({
      kind: "text",
      content: "SYNTHETIC_SECRET_FIXTURE",
    });
  });

  it("never sends a memory symlink's protected target to the model", async () => {
    native.canonicalize.mockResolvedValue("/repo-secret/.env");
    expect(await send("/repo-secret")).toBeNull();
    expect(native.readProjectMemory).not.toHaveBeenCalled();
    expect(native.readFile).not.toHaveBeenCalled();
  });

  it("omits memory rejected by the native project boundary", async () => {
    native.canonicalize.mockResolvedValue("/outside/instructions.md");
    native.readProjectMemory.mockRejectedValue(new Error("outside project"));
    expect(await send("/repo-escape")).toBeNull();
  });

  it("passes ordinary memory bytes and rechecks the next turn", async () => {
    native.canonicalize.mockResolvedValue("/repo-normal/TERAX.md");
    native.readProjectMemory.mockResolvedValue("project instructions");
    expect(await send("/repo-normal")).toBe("project instructions");
    expect(native.readProjectMemory).toHaveBeenCalledWith(
      "/repo-normal",
      "/repo-normal/TERAX.md",
      { kind: "local" },
    );
    native.canonicalize.mockResolvedValue("/repo-normal/.env");
    expect(await send("/repo-normal")).toBeNull();
  });

  it("fails closed if canonicalization fails", async () => {
    native.canonicalize.mockRejectedValue(new Error("unavailable"));
    expect(await send("/repo-missing")).toBeNull();
    expect(native.readProjectMemory).not.toHaveBeenCalled();
  });
});

it("keeps the captured workspace when it changes during canonicalization", async () => {
  currentWorkspaceEnv.mockReturnValue({ kind: "local" });
  native.canonicalize.mockImplementation(async () => {
    currentWorkspaceEnv.mockReturnValue({ kind: "wsl" });
    return "/repo-switch/TERAX.md";
  });
  native.readProjectMemory.mockResolvedValue("original workspace");
  expect(await send("/repo-switch")).toBe("original workspace");
  expect(native.readProjectMemory).toHaveBeenLastCalledWith("/repo-switch", "/repo-switch/TERAX.md", { kind: "local" });
});
