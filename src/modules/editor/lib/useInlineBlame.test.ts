import { describe, expect, it } from "vitest";
import { parentDir, samePath } from "./useInlineBlame";

describe("parentDir", () => {
  it("returns the containing directory", () => {
    expect(parentDir("/home/ada/src/main.rs")).toBe("/home/ada/src");
    expect(parentDir("C:\\Users\\ada\\main.rs")).toBe("C:\\Users\\ada");
  });

  it("keeps the filesystem root for root-level files", () => {
    expect(parentDir("/main.rs")).toBe("/");
    expect(parentDir("C:\\main.rs")).toBe("C:\\");
  });

  it("passes through a bare filename", () => {
    expect(parentDir("main.rs")).toBe("main.rs");
  });
});

describe("samePath", () => {
  it("matches across slash styles", () => {
    expect(samePath("C:\\repo\\file.ts", "C:/repo/file.ts")).toBe(true);
    expect(samePath("/repo/file.ts", "/repo/file.ts")).toBe(true);
  });

  it("does not match different files", () => {
    expect(samePath("/repo/a.ts", "/repo/b.ts")).toBe(false);
  });
});
