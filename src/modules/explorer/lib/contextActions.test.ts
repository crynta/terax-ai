import { describe, expect, it } from "vitest";
import { relativePath } from "@/modules/explorer/lib/contextActions";

describe("relativePath", () => {
  it("returns . for root itself", () => {
    expect(relativePath("/home/user/project", "/home/user/project")).toBe(".");
  });

  it("strips root prefix with forward slash", () => {
    expect(
      relativePath("/home/user/project", "/home/user/project/src/main.ts"),
    ).toBe("src/main.ts");
  });

  it("strips root prefix with backslash", () => {
    expect(
      relativePath(
        "C:\\Users\\dev\\project",
        "C:\\Users\\dev\\project\\src\\main.ts",
      ),
    ).toBe("src\\main.ts");
  });

  it("returns full path if not under root", () => {
    expect(relativePath("/home/user/project", "/other/path")).toBe(
      "/other/path",
    );
  });

  it("handles nested directories", () => {
    expect(
      relativePath(
        "/home/user/project",
        "/home/user/project/deep/nested/dir/file.ts",
      ),
    ).toBe("deep/nested/dir/file.ts");
  });
});
