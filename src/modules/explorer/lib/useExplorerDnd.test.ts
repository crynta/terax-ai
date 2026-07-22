import { describe, expect, it, vi } from "vitest";
import {
  finishExplorerDrag,
  resolveExplorerMoveTarget,
} from "./useExplorerDnd";

const directories = new Set(["/repo/src", "/repo/src/components"]);
const isDir = (path: string) => directories.has(path);

describe("resolveExplorerMoveTarget", () => {
  it("moves onto a hovered directory", () => {
    expect(
      resolveExplorerMoveTarget(
        "/repo/file.ts",
        "/repo",
        "/repo/src",
        true,
        isDir,
      ),
    ).toBe("/repo/src");
  });

  it("uses the parent when hovering a file", () => {
    expect(
      resolveExplorerMoveTarget(
        "/repo/file.ts",
        "/repo",
        "/repo/src/index.ts",
        true,
        isDir,
      ),
    ).toBe("/repo/src");
  });

  it("uses the root only over empty explorer space", () => {
    expect(
      resolveExplorerMoveTarget(
        "/repo/src/file.ts",
        "/repo",
        null,
        true,
        isDir,
      ),
    ).toBe("/repo");
  });

  it("does not turn a terminal hover into a root move", () => {
    expect(
      resolveExplorerMoveTarget(
        "/repo/src/file.ts",
        "/repo",
        null,
        false,
        isDir,
      ),
    ).toBeNull();
  });

  it("rejects no-op and recursive directory moves", () => {
    expect(
      resolveExplorerMoveTarget(
        "/repo/src/file.ts",
        "/repo",
        "/repo/src",
        true,
        isDir,
      ),
    ).toBeNull();
    expect(
      resolveExplorerMoveTarget(
        "/repo/src",
        "/repo",
        "/repo/src/components",
        true,
        isDir,
      ),
    ).toBeNull();
  });
});

describe("finishExplorerDrag", () => {
  it("uses a terminal-targeted drop without moving the explorer item", () => {
    const pathDropTarget = {
      updateTarget: vi.fn(() => true),
      dropPath: vi.fn(() => true),
      clearTarget: vi.fn(),
    };
    const onMove = vi.fn();

    finishExplorerDrag(
      true,
      "/repo/file.ts",
      100,
      200,
      null,
      pathDropTarget,
      onMove,
    );

    expect(pathDropTarget.dropPath).toHaveBeenCalledWith(
      "/repo/file.ts",
      100,
      200,
    );
    expect(pathDropTarget.clearTarget).toHaveBeenCalledOnce();
    expect(onMove).not.toHaveBeenCalled();
  });
});
