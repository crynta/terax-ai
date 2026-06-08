import { describe, expect, it } from "vitest";
import {
  getDiagnosticCode,
  isInactiveCodeDiagnostic,
  offsetToPosition,
  pathToUri,
  sameUri,
  uriToPath,
} from "./protocol";

describe("pathToUri", () => {
  it("normalizes Windows paths", () => {
    expect(pathToUri("C:\\Users\\dev\\main.ts")).toBe(
      "file:///C:/Users/dev/main.ts",
    );
  });

  it("keeps Unix paths", () => {
    expect(pathToUri("/home/dev/main.ts")).toBe("file:///home/dev/main.ts");
  });
});

describe("uriToPath", () => {
  it("restores Windows paths", () => {
    expect(uriToPath("file:///C:/Users/dev/main.ts")).toBe(
      "C:/Users/dev/main.ts",
    );
  });

  it("restores Unix paths", () => {
    expect(uriToPath("file:///home/dev/main.ts")).toBe("/home/dev/main.ts");
  });
});

describe("sameUri", () => {
  it("ignores Windows drive letter case", () => {
    expect(
      sameUri(
        "file:///C:/Users/dev/main.rs",
        "file:///c:/Users/dev/main.rs",
      ),
    ).toBe(true);
  });
});

describe("offsetToPosition", () => {
  it("maps offsets to line/character", () => {
    const text = "abc\ndef\nghi";
    expect(offsetToPosition(text, 0)).toEqual({ line: 0, character: 0 });
    expect(offsetToPosition(text, 5)).toEqual({ line: 1, character: 1 });
  });
});

describe("isInactiveCodeDiagnostic", () => {
  it("detects rust-analyzer inactive-code", () => {
    expect(
      isInactiveCodeDiagnostic({ code: "inactive-code" }),
    ).toBe(true);
    expect(
      isInactiveCodeDiagnostic({ code: { value: "inactive-code" } }),
    ).toBe(true);
    expect(isInactiveCodeDiagnostic({ code: "E0001" })).toBe(false);
    expect(getDiagnosticCode({ value: "foo" })).toBe("foo");
  });
});
