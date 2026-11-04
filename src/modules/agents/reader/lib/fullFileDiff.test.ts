import { describe, expect, it } from "vitest";
import {
  changeStarts,
  fullViewFromPatch,
  fullViewFromVersions,
  reverseApplyEdits,
  splitDisplayPath,
  splitLines,
  stepChange,
} from "./fullFileDiff";

const kinds = (rows: { kind: string; text: string }[]) =>
  rows.map((r) => `${r.kind[0]}:${r.text}`);

describe("fullViewFromPatch", () => {
  it("interleaves a replacement into the whole file", () => {
    const working = "a\nb\nC\nd\ne\n";
    const patch = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -2,3 +2,3 @@",
      " b",
      "-c",
      "+C",
      " d",
    ].join("\n");
    const rows = fullViewFromPatch(working, patch);
    expect(rows && kinds(rows)).toEqual([
      "c:a",
      "c:b",
      "r:c",
      "a:C",
      "c:d",
      "c:e",
    ]);
    expect(rows?.find((r) => r.text === "e")).toMatchObject({
      oldNo: 5,
      newNo: 5,
    });
  });

  it("handles pure insertions, deletions and several hunks", () => {
    const working = "1\n2\nnew\n3\n4\n5\n7\n";
    const patch = ["@@ -2,0 +3 @@", "+new", "@@ -5,2 +6 @@", " 5", "-6"].join(
      "\n",
    );
    const rows = fullViewFromPatch(working, patch);
    expect(rows && kinds(rows)).toEqual([
      "c:1",
      "c:2",
      "a:new",
      "c:3",
      "c:4",
      "c:5",
      "r:6",
      "c:7",
    ]);
    const seven = rows?.find((r) => r.text === "7");
    expect(seven).toMatchObject({ oldNo: 7, newNo: 7 });
  });

  it("ignores the no-newline marker and returns null without hunks", () => {
    const rows = fullViewFromPatch(
      "x\ny",
      "@@ -1,2 +1,2 @@\n x\n-z\n\\ No newline at end of file\n+y\n\\ No newline at end of file",
    );
    expect(rows && kinds(rows)).toEqual(["c:x", "r:z", "a:y"]);
    expect(fullViewFromPatch("x\n", "")).toBeNull();
  });
});

describe("fullViewFromVersions", () => {
  it("diffs two versions and treats a missing side as empty", () => {
    expect(kinds(fullViewFromVersions("a\nb\n", "a\nB\n"))).toEqual([
      "c:a",
      "r:b",
      "a:B",
    ]);
    expect(kinds(fullViewFromVersions(null, "n\n"))).toEqual(["a:n"]);
    expect(kinds(fullViewFromVersions("o\n", null))).toEqual(["r:o"]);
  });
});

describe("change navigation", () => {
  it("finds each run of changes and steps through them", () => {
    const rows = fullViewFromVersions("a\nb\nc\nd\n", "a\nB\nc\nD\n");
    const starts = changeStarts(rows);
    expect(starts).toEqual([1, 4]);
    expect(stepChange(starts.length, -1, 1)).toBe(0);
    expect(stepChange(starts.length, 0, 1)).toBe(1);
    expect(stepChange(starts.length, 1, 1)).toBe(1);
    expect(stepChange(starts.length, 0, -1)).toBe(0);
    expect(stepChange(0, -1, 1)).toBe(-1);
  });
});

describe("reverseApplyEdits", () => {
  it("undoes edits newest first and stops at a Write", () => {
    const now = "const a = 2;\nconst b = 3;\n";
    expect(
      reverseApplyEdits(now, [
        {
          kind: "edit",
          oldString: "a = 1",
          newString: "a = 2",
          replaceAll: false,
        },
        {
          kind: "edit",
          oldString: "b = 1",
          newString: "b = 3",
          replaceAll: false,
        },
      ]),
    ).toBe("const a = 1;\nconst b = 1;\n");
    expect(
      reverseApplyEdits("x", [{ kind: "write", content: "x", created: true }]),
    ).toBe("");
    expect(
      reverseApplyEdits("y2", [
        { kind: "write", content: "y", created: false },
        { kind: "edit", oldString: "y", newString: "y2", replaceAll: false },
      ]),
    ).toBe("y");
  });
});

describe("splitDisplayPath", () => {
  it("splits name and folder relative to the session", () => {
    expect(splitDisplayPath("/r/src/modules/a.ts", "/r", "/Users/me")).toEqual({
      name: "a.ts",
      dir: "src/modules",
    });
    expect(splitDisplayPath("/r/a.ts", "/r")).toEqual({
      name: "a.ts",
      dir: "",
    });
    expect(splitDisplayPath("/Users/me/x/y.md", "/r", "/Users/me")).toEqual({
      name: "y.md",
      dir: "~/x",
    });
    expect(splitLines("a\n")).toEqual(["a"]);
  });
});
