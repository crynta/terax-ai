import { describe, expect, it } from "vitest";
import { resolvePath } from "./context";

describe("resolvePath", () => {
  it("returns a unix absolute path unchanged", () => {
    expect(resolvePath("/etc/hosts", "/home/me")).toBe("/etc/hosts");
  });

  it("returns a windows absolute path unchanged", () => {
    expect(resolvePath("C:/Users/a", "/home")).toBe("C:/Users/a");
    expect(resolvePath("C:\\Users\\a", "/home")).toBe("C:\\Users\\a");
  });

  it("returns a windows UNC path unchanged instead of prefixing the cwd", () => {
    const unc = "\\\\server\\share\\file.txt";
    expect(resolvePath(unc, "/home/me")).toBe(unc);
  });

  it("joins a relative path onto a unix cwd", () => {
    expect(resolvePath("file.txt", "/home/me")).toBe("/home/me/file.txt");
  });

  it("does not double the separator when cwd already ends with one", () => {
    expect(resolvePath("file.txt", "/home/me/")).toBe("/home/me/file.txt");
  });

  it("joins with a backslash on a windows cwd", () => {
    expect(resolvePath("file.txt", "C:\\Users\\me")).toBe(
      "C:\\Users\\me\\file.txt",
    );
  });

  it("throws for a relative path when there is no cwd", () => {
    expect(() => resolvePath("file.txt", null)).toThrow(
      /no active terminal cwd/,
    );
  });
});
