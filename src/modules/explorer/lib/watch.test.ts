import { beforeEach, describe, expect, it, vi } from "vitest";
import { watchAdd, watchRemove } from "@/modules/explorer/lib/watch";
import type { WorkspaceEnv } from "@/modules/workspace";

const { invoke, active } = vi.hoisted(() => ({
  invoke: vi.fn(),
  active: { env: { kind: "local" } as WorkspaceEnv },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => active.env,
}));

const wsl: WorkspaceEnv = { kind: "wsl", distro: "Ubuntu" };
const local: WorkspaceEnv = { kind: "local" };

beforeEach(() => {
  vi.resetAllMocks();
  invoke.mockResolvedValue(undefined);
  active.env = local;
});

describe("watch workspace", () => {
  it("defaults to the active workspace", () => {
    active.env = wsl;
    watchAdd(["/d"], ["/d/f"]);
    expect(invoke).toHaveBeenCalledWith("fs_watch_add", {
      paths: ["/d"],
      files: ["/d/f"],
      workspace: wsl,
    });
  });

  it("removes under the workspace it was added under, not the active one", () => {
    watchAdd(["/d"], ["/d/f"], local);
    active.env = wsl;
    watchRemove(["/d"], ["/d/f"], local);
    expect(invoke).toHaveBeenNthCalledWith(1, "fs_watch_add", {
      paths: ["/d"],
      files: ["/d/f"],
      workspace: local,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "fs_watch_remove", {
      paths: ["/d"],
      files: ["/d/f"],
      workspace: local,
    });
  });

  it("sends nothing for an empty request", () => {
    watchAdd([], [], local);
    watchRemove([], [], local);
    expect(invoke).not.toHaveBeenCalled();
  });
});
