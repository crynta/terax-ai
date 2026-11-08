import { describe, expect, it } from "vitest";
import { decideSave } from "./saveConflict";

describe("decideSave", () => {
  it("writes when mtime is unchanged", () => {
    expect(
      decideSave({
        knownMtime: 1,
        statMtime: 1,
        diskText: "other",
        savedText: "a",
      }),
    ).toBe("write");
  });

  it("writes when mtime differs but content is identical", () => {
    expect(
      decideSave({
        knownMtime: 1,
        statMtime: 2,
        diskText: "a",
        savedText: "a",
      }),
    ).toBe("write");
  });

  it("conflicts when mtime and content differ", () => {
    expect(
      decideSave({
        knownMtime: 1,
        statMtime: 2,
        diskText: "b",
        savedText: "a",
      }),
    ).toBe("conflict");
  });

  it("conflicts when the disk content is not readable as text", () => {
    expect(
      decideSave({
        knownMtime: 1,
        statMtime: 2,
        diskText: null,
        savedText: "a",
      }),
    ).toBe("conflict");
  });

  it("writes when there is no known mtime or stat failed", () => {
    expect(
      decideSave({
        knownMtime: null,
        statMtime: 2,
        diskText: null,
        savedText: "a",
      }),
    ).toBe("write");
    expect(
      decideSave({
        knownMtime: 1,
        statMtime: null,
        diskText: null,
        savedText: "a",
      }),
    ).toBe("write");
  });
});
