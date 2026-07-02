import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./gitGutter";

describe("parseUnifiedDiff", () => {
  it("returns nothing for empty input", () => {
    const c = parseUnifiedDiff("");
    expect(c.added.size + c.modified.size + c.deleted.size).toBe(0);
  });

  it("marks a pure insertion as added on the new-file line", () => {
    // Insert one line after line 1 (context), so the new line 2 is added.
    const diff = [
      "diff --git a/f b/f",
      "--- a/f",
      "+++ b/f",
      "@@ -1,2 +1,3 @@",
      " a",
      "+inserted",
      " b",
      "",
    ].join("\n");
    const c = parseUnifiedDiff(diff);
    expect([...c.added]).toEqual([2]);
    expect(c.modified.size).toBe(0);
    expect(c.deleted.size).toBe(0);
  });

  it("marks a replaced line as modified", () => {
    // Line 2 replaced: one deletion immediately followed by one addition.
    const diff = [
      "@@ -1,3 +1,3 @@",
      " a",
      "-old",
      "+new",
      " c",
      "",
    ].join("\n");
    const c = parseUnifiedDiff(diff);
    expect([...c.modified]).toEqual([2]);
    expect(c.added.size).toBe(0);
  });

  it("marks a boundary for a pure deletion", () => {
    // Delete line 2; the deletion boundary lands on the following new-file line.
    const diff = ["@@ -1,3 +1,2 @@", " a", "-gone", " c", ""].join("\n");
    const c = parseUnifiedDiff(diff);
    expect([...c.deleted]).toEqual([2]);
    expect(c.added.size + c.modified.size).toBe(0);
  });

  it("does not treat added content beginning with '-' as a header", () => {
    const diff = ["@@ -1,1 +1,2 @@", " a", "+- a bullet", ""].join("\n");
    const c = parseUnifiedDiff(diff);
    expect([...c.added]).toEqual([2]);
  });
});
