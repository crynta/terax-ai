import { describe, expect, it } from "vitest";
import { relativePath, spaceNameFromRoot } from "./contextActions";

describe("spaceNameFromRoot", () => {
  it("names a Space from Unix and Windows folder basenames", () => {
    expect(spaceNameFromRoot("/work/terax")).toBe("terax");
    expect(spaceNameFromRoot("C:\\work\\terax")).toBe("terax");
  });
});

describe("relativePath", () => {
  it("returns '.' when the path is the root itself", () => {
    expect(relativePath("/a/b", "/a/b")).toBe(".");
  });

  it("strips the root prefix for a descendant path", () => {
    expect(relativePath("/a/b", "/a/b/c/d")).toBe("c/d");
  });

  it("does not relativize a sibling that only shares the root prefix", () => {
    expect(relativePath("/a/b", "/a/bc/d")).toBe("/a/bc/d");
  });

  it("returns an unrelated path unchanged", () => {
    expect(relativePath("/a/b", "/x/y")).toBe("/x/y");
  });
});
