import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_FORCE_RELOAD_EVENT,
  absoluteEditorPaths,
  armForceReload,
  clearPendingForceReloads,
  editorTabIdsForPaths,
  normalizeEditorPath,
  notifyEditorForceReload,
  takeForceReload,
  type EditorForceReloadDetail,
} from "./editorForceReload";
import { shouldProceedReload } from "./useDocument";

describe("normalizeEditorPath", () => {
  it("normalizes Windows separators", () => {
    expect(normalizeEditorPath("C:\\repo\\main.go")).toBe("C:/repo/main.go");
  });
});

describe("absoluteEditorPaths", () => {
  it("joins repo-relative paths to the repo root", () => {
    expect(absoluteEditorPaths("C:\\repo", ["src/a.ts", "b.ts"])).toEqual([
      "C:/repo/src/a.ts",
      "C:/repo/b.ts",
    ]);
  });

  it("keeps already-absolute paths", () => {
    expect(absoluteEditorPaths("/repo", ["/repo/a.ts", "C:\\x\\y.ts"])).toEqual([
      "/repo/a.ts",
      "C:/x/y.ts",
    ]);
  });

  it("preserves POSIX root when joining relative paths", () => {
    expect(absoluteEditorPaths("/", ["src/main.ts", "a.ts"])).toEqual([
      "/src/main.ts",
      "/a.ts",
    ]);
  });
});

describe("shouldProceedReload", () => {
  it("skips a dirty buffer on a normal reload", () => {
    expect(shouldProceedReload(true)).toBe(false);
    expect(shouldProceedReload(true, {})).toBe(false);
    expect(shouldProceedReload(true, { force: false })).toBe(false);
  });

  it("reloads a clean buffer", () => {
    expect(shouldProceedReload(false)).toBe(true);
  });

  it("force-reloads even when the buffer is still dirty", () => {
    expect(shouldProceedReload(true, { force: true })).toBe(true);
  });
});

describe("editorTabIdsForPaths", () => {
  const tabs = [
    { id: 1, kind: "editor", path: "/repo/main.go" },
    { id: 2, kind: "editor", path: "/repo/other.go" },
    { id: 3, kind: "terminal", path: "/repo/main.go" },
    { id: 4, kind: "editor", path: "C:\\repo\\main.go" },
  ];

  it("returns only matching editor tabs for discarded paths", () => {
    expect(editorTabIdsForPaths(tabs, ["/repo/main.go"])).toEqual([1]);
  });

  it("matches Windows-normalized absolute paths separately", () => {
    expect(editorTabIdsForPaths(tabs, ["C:/repo/main.go"])).toEqual([4]);
  });

  it("leaves unrelated dirty editor tabs alone", () => {
    expect(editorTabIdsForPaths(tabs, ["/repo/main.go"])).not.toContain(2);
  });

  it("returns empty when no paths match", () => {
    expect(editorTabIdsForPaths(tabs, ["/repo/missing.go"])).toEqual([]);
  });
});

describe("notifyEditorForceReload + takeForceReload", () => {
  beforeEach(() => {
    // Vitest runs in Node; stub window so dispatchEvent tests do not need jsdom.
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(() => true),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    clearPendingForceReloads();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dispatches editor:force-reload with normalized paths", () => {
    notifyEditorForceReload(["/repo/main.go", "C:\\repo\\other.go", ""]);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = (window.dispatchEvent as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as CustomEvent<EditorForceReloadDetail>;
    expect(event.type).toBe(EDITOR_FORCE_RELOAD_EVENT);
    expect(event.detail.paths).toEqual([
      "/repo/main.go",
      "C:/repo/other.go",
    ]);
  });

  it("is a no-op for an empty path list", () => {
    notifyEditorForceReload([]);
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it("force-reloads the discarded path and leaves unrelated tabs alone", () => {
    notifyEditorForceReload(["/repo/main.go"]);
    expect(takeForceReload("/repo/main.go")).toBe(true);
    // consumed once
    expect(takeForceReload("/repo/main.go")).toBe(false);
    // unrelated path never marked
    expect(takeForceReload("/repo/other.go")).toBe(false);
  });

  it("armForceReload re-marks a path for sibling tabs", () => {
    armForceReload(["/repo/main.go"]);
    expect(takeForceReload("/repo/main.go")).toBe(true);
    armForceReload(["/repo/main.go"]);
    expect(takeForceReload("/repo/main.go")).toBe(true);
  });
});
