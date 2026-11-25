import { describe, expect, it } from "vitest";
import { fileUriToPath, pathToFileUri, sameFileUri } from "./uri";

describe("pathToFileUri", () => {
  it("encodes a unix path", () => {
    expect(pathToFileUri("/Users/me/src/app.ts")).toBe(
      "file:///Users/me/src/app.ts",
    );
  });

  it("encodes a windows path with drive letter", () => {
    expect(pathToFileUri("C:/Users/me/app.ts")).toBe(
      "file:///C:/Users/me/app.ts",
    );
    expect(pathToFileUri("C:\\Users\\me\\app.ts")).toBe(
      "file:///C:/Users/me/app.ts",
    );
  });

  it("percent-encodes special characters but not colon or plus", () => {
    expect(pathToFileUri("/a b/c#d/e%f/g+h.ts")).toBe(
      "file:///a%20b/c%23d/e%25f/g+h.ts",
    );
  });
});

describe("fileUriToPath", () => {
  it("roundtrips unix paths", () => {
    expect(fileUriToPath(pathToFileUri("/Users/me/a b/app.ts"))).toBe(
      "/Users/me/a b/app.ts",
    );
  });

  it("strips the leading slash on windows drive URIs", () => {
    expect(fileUriToPath("file:///C:/Users/me/app.ts")).toBe(
      "C:/Users/me/app.ts",
    );
  });

  it("rejects non-file uris", () => {
    expect(fileUriToPath("https://example.com/x")).toBeNull();
  });
});

describe("sameFileUri", () => {
  it("matches a pyright-style windows uri against pathToFileUri output", () => {
    // pyright answers file:///d%3A/... where we produce file:///D:/...
    expect(
      sameFileUri(
        "file:///d%3A/projects/sample/src/a.py",
        pathToFileUri("D:\\projects\\sample\\src\\a.py"),
      ),
    ).toBe(true);
  });

  it("matches identical unix uris", () => {
    expect(
      sameFileUri(
        "file:///repo/a%20b.ts",
        pathToFileUri("/repo/a b.ts"),
      ),
    ).toBe(true);
  });

  it("rejects different files and non-file uris", () => {
    expect(sameFileUri("file:///repo/a.ts", "file:///repo/b.ts")).toBe(false);
    expect(sameFileUri("file:///repo/a.ts", "untitled:Untitled-1")).toBe(false);
  });
});
