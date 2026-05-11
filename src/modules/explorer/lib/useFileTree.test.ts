import { describe, expect, it } from "vitest";
import { joinPath, dirname } from "@/modules/explorer/lib/useFileTree";

describe("joinPath", () => {
  it("joins with forward slash", () => {
    expect(joinPath("/home/user", "file.ts")).toBe("/home/user/file.ts");
  });

  it("handles trailing slash", () => {
    expect(joinPath("/home/user/", "file.ts")).toBe("/home/user/file.ts");
  });

  it("joins with backslash on Windows paths", () => {
    expect(joinPath("C:\\Users\\dev", "file.ts")).toBe(
      "C:\\Users\\dev\\file.ts",
    );
  });

  it("handles trailing backslash", () => {
    expect(joinPath("C:\\Users\\dev\\", "file.ts")).toBe(
      "C:\\Users\\dev\\file.ts",
    );
  });
});

describe("dirname", () => {
  it("returns parent with forward slash", () => {
    expect(dirname("/home/user/src/main.ts")).toBe("/home/user/src");
  });

  it("returns parent with backslash", () => {
    expect(dirname("C:\\Users\\dev\\file.ts")).toBe("C:\\Users\\dev");
  });

  it("returns root for top-level", () => {
    expect(dirname("/home")).toBe("/");
  });

  it("handles mixed separators (picks last)", () => {
    expect(dirname("C:\\Users/dev/file.ts")).toBe("C:\\Users/dev");
  });
});
