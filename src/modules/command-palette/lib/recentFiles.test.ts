import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_FILES,
  recentFiles,
  recordInStore,
  recordRecentFile,
  touchRecent,
} from "./recentFiles";

describe("touchRecent", () => {
  it("moves an existing path to the front without duplicating it", () => {
    expect(touchRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });

  it("caps the list, dropping the oldest", () => {
    const many = Array.from({ length: MAX_RECENT_FILES }, (_, i) => `f${i}`);
    const out = touchRecent(many, "new");
    expect(out).toHaveLength(MAX_RECENT_FILES);
    expect(out[0]).toBe("new");
    expect(out).not.toContain(`f${MAX_RECENT_FILES - 1}`);
  });
});

describe("recordInStore", () => {
  it("keeps projects apart", () => {
    let store = recordInStore({}, "/a", "/a/x.ts");
    store = recordInStore(store, "/b", "/b/y.ts");
    expect(store).toEqual({ "/a": ["/a/x.ts"], "/b": ["/b/y.ts"] });
  });

  it("drops the least recently used roots beyond the cap", () => {
    let store = recordInStore({}, "/a", "/a/1");
    store = recordInStore(store, "/b", "/b/1", 2);
    store = recordInStore(store, "/a", "/a/2", 2);
    store = recordInStore(store, "/c", "/c/1", 2);
    expect(Object.keys(store).sort()).toEqual(["/a", "/c"]);
  });

  it("does not mutate the previous store", () => {
    const before = { "/a": ["/a/1"] };
    recordInStore(before, "/a", "/a/2");
    expect(before).toEqual({ "/a": ["/a/1"] });
  });
});

describe("persistence without localStorage", () => {
  // The vitest node environment has no localStorage; the store must degrade
  // gracefully rather than throw.
  it("reads empty and ignores writes", () => {
    expect(recentFiles("/a")).toEqual([]);
    expect(() => recordRecentFile("/a", "/a/x.ts")).not.toThrow();
  });
});
