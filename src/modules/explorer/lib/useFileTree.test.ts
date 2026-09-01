import { describe, expect, it } from "vitest";
import { excludeNestedSources, planBatchMove } from "./useFileTree";

describe("planBatchMove", () => {
  it("plans a conflict-free batch with no collisions", () => {
    const items = planBatchMove(
      ["/repo/src/a.ts", "/repo/other/b.ts"],
      "/repo/dest",
      ["existing.ts"],
    );
    expect(items).toEqual([
      { from: "/repo/src/a.ts", to: "/repo/dest/a.ts", name: "a.ts", conflict: false },
      { from: "/repo/other/b.ts", to: "/repo/dest/b.ts", name: "b.ts", conflict: false },
    ]);
  });

  it("flags a destination collision against an existing entry", () => {
    const items = planBatchMove(["/repo/src/a.ts"], "/repo/dest", ["a.ts"]);
    expect(items).toEqual([
      { from: "/repo/src/a.ts", to: "/repo/dest/a.ts", name: "a.ts", conflict: true },
    ]);
  });

  it("flags a within-batch basename collision, earlier item wins the name", () => {
    const items = planBatchMove(
      ["/repo/src/a.ts", "/repo/other/a.ts"],
      "/repo/dest",
      [],
    );
    expect(items).toEqual([
      { from: "/repo/src/a.ts", to: "/repo/dest/a.ts", name: "a.ts", conflict: false },
      { from: "/repo/other/a.ts", to: "/repo/dest/a.ts", name: "a.ts", conflict: true },
    ]);
  });

  it("drops sources already directly in the target as no-ops", () => {
    const items = planBatchMove(
      ["/repo/dest/already-there.ts", "/repo/src/new.ts"],
      "/repo/dest",
      ["already-there.ts"],
    );
    expect(items).toEqual([
      {
        from: "/repo/src/new.ts",
        to: "/repo/dest/new.ts",
        name: "new.ts",
        conflict: false,
      },
    ]);
  });

  it("handles mixed-depth sources landing in the same target", () => {
    const items = planBatchMove(
      ["/repo/a.ts", "/repo/deep/nested/dir/b.ts"],
      "/repo/dest",
      [],
    );
    expect(items.map((i) => i.to)).toEqual([
      "/repo/dest/a.ts",
      "/repo/dest/b.ts",
    ]);
  });
});

describe("excludeNestedSources", () => {
  it("drops a descendant when its ancestor is also selected", () => {
    expect(
      excludeNestedSources(["/repo/src", "/repo/src/nested/a.ts"]),
    ).toEqual(["/repo/src"]);
  });

  it("drops multiple descendants at different depths", () => {
    expect(
      excludeNestedSources([
        "/repo/src",
        "/repo/src/a.ts",
        "/repo/src/deep/nested/b.ts",
        "/repo/other.ts",
      ]),
    ).toEqual(["/repo/src", "/repo/other.ts"]);
  });

  it("keeps unrelated sources whose names merely share a prefix", () => {
    expect(
      excludeNestedSources(["/repo/src", "/repo/src-backup/a.ts"]),
    ).toEqual(["/repo/src", "/repo/src-backup/a.ts"]);
  });

  it("is a no-op when no source is nested under another", () => {
    expect(
      excludeNestedSources(["/repo/a.ts", "/repo/dir/b.ts", "/repo/c.ts"]),
    ).toEqual(["/repo/a.ts", "/repo/dir/b.ts", "/repo/c.ts"]);
  });
});
