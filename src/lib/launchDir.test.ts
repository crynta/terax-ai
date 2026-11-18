import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getExplicitLaunchDir, getLaunchDir, initLaunchDir } from "./launchDir";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => invokeMock.mockReset());

describe("launch directory", () => {
  it("preserves the explicit Explorer folder as a normalized path", async () => {
    invokeMock.mockResolvedValueOnce("D:\\Projects\\My App");

    await initLaunchDir();

    expect(getExplicitLaunchDir()).toBe("D:/Projects/My App");
    expect(getLaunchDir()).toBe("D:/Projects/My App");
    expect(invokeMock.mock.calls).toEqual([["get_launch_dir"]]);
  });

  it("does not treat the process directory as an explicit folder", async () => {
    invokeMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("C:\\Windows\\System32");

    await initLaunchDir();

    expect(getExplicitLaunchDir()).toBeUndefined();
    expect(getLaunchDir()).toBe("C:/Windows/System32");
  });
});
