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
        ["/repo/file.ts"],
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
        ["/repo/file.ts"],
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
        ["/repo/src/file.ts"],
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
        ["/repo/src/file.ts"],
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
        ["/repo/src/file.ts"],
        "/repo",
        "/repo/src",
        true,
        isDir,
      ),
    ).toBeNull();
    expect(
      resolveExplorerMoveTarget(
        ["/repo/src"],
        "/repo",
        "/repo/src/components",
        true,
        isDir,
      ),
    ).toBeNull();
  });

  it("moves a multi-item selection at mixed depths onto a shared target", () => {
    expect(
      resolveExplorerMoveTarget(
        ["/repo/file.ts", "/repo/src/index.ts"],
        "/repo",
        "/repo/src/components",
        true,
        isDir,
      ),
    ).toBe("/repo/src/components");
  });

  it("rejects the whole batch when every item is already directly in the target", () => {
    expect(
      resolveExplorerMoveTarget(
        ["/repo/src/file.ts", "/repo/src/other.ts"],
        "/repo",
        "/repo/src",
        true,
        isDir,
      ),
    ).toBeNull();
  });

  it("allows a mixed batch where only some items already sit in the target", () => {
    expect(
      resolveExplorerMoveTarget(
        ["/repo/src/file.ts", "/repo/other.ts"],
        "/repo",
        "/repo/src",
        true,
        isDir,
      ),
    ).toBe("/repo/src");
  });

  it("rejects a target nested inside one of the sources", () => {
    expect(
      resolveExplorerMoveTarget(
        ["/repo/file.ts", "/repo/src"],
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
      ["/repo/file.ts"],
      100,
      200,
      null,
      pathDropTarget,
      onMove,
    );

    expect(pathDropTarget.dropPath).toHaveBeenCalledWith(
      ["/repo/file.ts"],
      100,
      200,
    );
    expect(pathDropTarget.clearTarget).toHaveBeenCalledOnce();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("passes the full source set to onMove on a plain explorer drop", () => {
    const onMove = vi.fn();
    finishExplorerDrag(
      true,
      ["/repo/a.ts", "/repo/b.ts"],
      100,
      200,
      "/repo/dest",
      undefined,
      onMove,
    );
    expect(onMove).toHaveBeenCalledWith(["/repo/a.ts", "/repo/b.ts"], "/repo/dest");
  });
});
