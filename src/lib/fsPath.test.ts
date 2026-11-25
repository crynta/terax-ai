import { describe, expect, it } from "vitest";
import { normalizeFsPath, sameFsPath } from "./fsPath";

describe("normalizeFsPath", () => {
  it("unifies separators and the drive letter", () => {
    expect(normalizeFsPath("d:\\projects\\sample\\a.py")).toBe(
      "D:/projects/sample/a.py",
    );
    expect(normalizeFsPath("d:/projects/sample/a.py")).toBe(
      "D:/projects/sample/a.py",
    );
  });

  it("leaves unix paths untouched", () => {
    expect(normalizeFsPath("/repo/main.rs")).toBe("/repo/main.rs");
  });

  it("keeps the case of non-drive segments", () => {
    expect(normalizeFsPath("C:\\Repo\\Main.rs")).toBe("C:/Repo/Main.rs");
    expect(sameFsPath("C:/Repo/Main.rs", "C:/repo/main.rs")).toBe(false);
  });
});

describe("sameFsPath", () => {
  it("matches a file:// spelling against a native one", () => {
    expect(sameFsPath("d:/projects/sample/a.py", "D:\\projects\\sample\\a.py"))
      .toBe(true);
  });
});
