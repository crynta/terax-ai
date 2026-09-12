import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

import { consumeLaunchFiles, getLaunchDir, initLaunchDir } from "./launchDir";

describe("launch context", () => {
  beforeEach(() => {
    core.invoke.mockReset();
  });

  it("prefers the CLI launch dir and normalizes separators", async () => {
    core.invoke.mockResolvedValueOnce("C:\\repo\\sub");

    await initLaunchDir();

    expect(getLaunchDir()).toBe("C:/repo/sub");
    expect(core.invoke).toHaveBeenNthCalledWith(1, "get_launch_dir");
    expect(core.invoke).toHaveBeenCalledTimes(1);
  });

  it("falls back to the workspace cwd when no CLI dir was passed", async () => {
    core.invoke
      .mockRejectedValueOnce(new Error("none"))
      .mockResolvedValueOnce("/home/me/repo");

    await initLaunchDir();

    expect(getLaunchDir()).toBe("/home/me/repo");
  });

  it("caches an undefined dir when both probes fail", async () => {
    core.invoke.mockRejectedValue(new Error("down"));

    await initLaunchDir();

    expect(getLaunchDir()).toBeUndefined();
  });

  it("normalizes opened file paths to forward slashes", async () => {
    core.invoke.mockResolvedValueOnce([
      "C:\\repo\\a.ts",
      "/home/me/b.ts",
      "already/clean.ts",
    ]);

    await expect(consumeLaunchFiles()).resolves.toEqual([
      "C:/repo/a.ts",
      "/home/me/b.ts",
      "already/clean.ts",
    ]);
  });

  it("returns an empty list when the backend probe fails", async () => {
    core.invoke.mockRejectedValueOnce(new Error("no files"));

    await expect(consumeLaunchFiles()).resolves.toEqual([]);
  });
});
