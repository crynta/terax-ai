import { describe, expect, it } from "vitest";
import { formatDroppedPaths, parsePaneLeafId } from "./fileDrop";

describe("formatDroppedPaths", () => {
  it("quotes a dropped POSIX path and leaves a space for the next token", () => {
    expect(formatDroppedPaths(["/tmp/screen shot.png"], false)).toBe(
      "'/tmp/screen shot.png' ",
    );
  });

  it("quotes multiple POSIX paths without dropping embedded quotes", () => {
    expect(
      formatDroppedPaths(["/tmp/first.png", "/tmp/it's here.txt"], false),
    ).toBe("'/tmp/first.png' '/tmp/it'\\''s here.txt' ");
  });

  it("uses PowerShell-compatible quoting on Windows", () => {
    expect(formatDroppedPaths(["C:\\Users\\Arya\\it's here.png"], true)).toBe(
      "'C:\\Users\\Arya\\it''s here.png' ",
    );
  });

  it("ignores empty paths", () => {
    expect(formatDroppedPaths(["", "/tmp/file.png"], false)).toBe(
      "'/tmp/file.png' ",
    );
    expect(formatDroppedPaths([], false)).toBe("");
  });
});

describe("parsePaneLeafId", () => {
  it("accepts positive integer leaf ids", () => {
    expect(parsePaneLeafId("1")).toBe(1);
    expect(parsePaneLeafId("42")).toBe(42);
  });

  it("rejects missing, zero, negative, and partial ids", () => {
    expect(parsePaneLeafId(undefined)).toBeNull();
    expect(parsePaneLeafId("0")).toBeNull();
    expect(parsePaneLeafId("-1")).toBeNull();
    expect(parsePaneLeafId("1x")).toBeNull();
  });
});
