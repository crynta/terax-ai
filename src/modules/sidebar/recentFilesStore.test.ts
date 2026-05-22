import { describe, it, expect, beforeEach } from "vitest";
import { useRecentFilesStore } from "./recentFilesStore";

beforeEach(() => {
  useRecentFilesStore.setState({ paths: [] });
});

describe("recentFilesStore", () => {
  it("pushes a new path to the front", () => {
    useRecentFilesStore.getState().push("/a/b.ts");
    expect(useRecentFilesStore.getState().paths[0]).toBe("/a/b.ts");
  });

  it("deduplicates: re-pushed path moves to front", () => {
    useRecentFilesStore.getState().push("/a/b.ts");
    useRecentFilesStore.getState().push("/a/c.ts");
    useRecentFilesStore.getState().push("/a/b.ts");
    expect(useRecentFilesStore.getState().paths).toEqual(["/a/b.ts", "/a/c.ts"]);
  });

  it("caps at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      useRecentFilesStore.getState().push(`/file${i}.ts`);
    }
    expect(useRecentFilesStore.getState().paths.length).toBe(50);
  });

  it("clear empties the list", () => {
    useRecentFilesStore.getState().push("/a.ts");
    useRecentFilesStore.getState().clear();
    expect(useRecentFilesStore.getState().paths).toEqual([]);
  });
});
