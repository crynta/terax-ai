import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  tauriWorkflowArtifactFileSystem,
  workflowArtifactNativePreviewSource,
} from "./nativeArtifactStorage";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}));

vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));

describe("native workflow artifact storage", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(convertFileSrc).mockClear();
  });

  it("writes binary artifact payloads through the base64 file command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await tauriWorkflowArtifactFileSystem.writeBase64File?.(
      "/repo/.terax-artifacts/image.png",
      "ZmFrZQ==",
      "workflow-artifact-binary",
    );

    expect(invoke).toHaveBeenCalledWith("fs_write_base64_file", {
      path: "/repo/.terax-artifacts/image.png",
      contentBase64: "ZmFrZQ==",
      workspace: { kind: "local" },
      source: "workflow-artifact-binary",
    });
  });

  it("copies file-backed artifacts through the native copy command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await tauriWorkflowArtifactFileSystem.copyFile?.(
      "/repo/.terax-artifacts/image.png",
      "/tmp/exported.png",
      "workflow-artifact-export",
    );

    expect(invoke).toHaveBeenCalledWith("fs_copy_file", {
      from: "/repo/.terax-artifacts/image.png",
      to: "/tmp/exported.png",
      workspace: { kind: "local" },
      source: "workflow-artifact-export",
    });
  });

  it("opens file-backed artifacts through the native open command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await tauriWorkflowArtifactFileSystem.openFile?.(
      "/repo/.terax-artifacts/image.svg",
    );

    expect(invoke).toHaveBeenCalledWith("fs_open_file", {
      path: "/repo/.terax-artifacts/image.svg",
      workspace: { kind: "local" },
    });
  });

  it("ignores existing artifact storage directories", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("already exists: /repo"));

    await expect(
      tauriWorkflowArtifactFileSystem.createDirectory?.("/repo"),
    ).resolves.toBeUndefined();
  });

  it("converts durable local paths to Tauri asset URLs for previews", () => {
    expect(workflowArtifactNativePreviewSource("/repo/image.png")).toBe(
      "asset:///repo/image.png",
    );
    expect(
      workflowArtifactNativePreviewSource("data:image/png;base64,AA=="),
    ).toBe("data:image/png;base64,AA==");
  });
});
