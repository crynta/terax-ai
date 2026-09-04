import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_FORCE_RELOAD_EVENT,
  editorTabIdsForPaths,
  normalizeEditorPath,
  notifyEditorForceReload,
  type EditorForceReloadDetail,
} from "./editorForceReload";
import { shouldProceedReload } from "./useDocument";

describe("normalizeEditorPath", () => {
  it("normalizes Windows separators", () => {
    expect(normalizeEditorPath("C:\\repo\\main.go")).toBe("C:/repo/main.go");
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
    expect(editorTabIdsForPaths(tabs, ["/repo/main.go"])).toEqual([1, 4]);
  });

  it("leaves unrelated dirty editor tabs alone", () => {
    expect(editorTabIdsForPaths(tabs, ["/repo/main.go"])).not.toContain(2);
  });

  it("returns empty when no paths match", () => {
    expect(editorTabIdsForPaths(tabs, ["/repo/missing.go"])).toEqual([]);
  });
});

describe("notifyEditorForceReload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches editor:force-reload with normalized paths", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    notifyEditorForceReload(["/repo/main.go", "C:\\repo\\other.go", ""]);
    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0][0] as CustomEvent<EditorForceReloadDetail>;
    expect(event.type).toBe(EDITOR_FORCE_RELOAD_EVENT);
    expect(event.detail.paths).toEqual([
      "/repo/main.go",
      "C:/repo/other.go",
    ]);
  });

  it("is a no-op for an empty path list", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    notifyEditorForceReload([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
