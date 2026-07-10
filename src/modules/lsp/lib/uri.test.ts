import { describe, expect, it } from "vitest";
import { fileUriToPath, pathToFileUri } from "./uri";

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
