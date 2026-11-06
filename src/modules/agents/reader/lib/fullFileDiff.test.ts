import { describe, expect, it } from "vitest";
import { reverseApplyEdits, splitDisplayPath } from "./fullFileDiff";

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
  });
});
