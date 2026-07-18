import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { readRangeText } from "./readBlock";

function fakeTerm(lines: (string | undefined)[]): Terminal {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (i: number) =>
          lines[i] === undefined
            ? undefined
            : { translateToString: () => lines[i] as string },
      },
    },
  } as unknown as Terminal;
}

describe("readRangeText", () => {
  it("joins the requested line range", () => {
    expect(readRangeText(fakeTerm(["a", "b", "c"]), 0, 2)).toBe("a\nb\nc");
  });

  it("drops trailing empty lines", () => {
    expect(readRangeText(fakeTerm(["a", "b", "c", "", ""]), 0, 4)).toBe(
      "a\nb\nc",
    );
  });

  it("clamps the end to the last buffer line", () => {
    expect(readRangeText(fakeTerm(["a", "b", "c"]), 1, 99)).toBe("b\nc");
  });

  it("clamps a negative start to zero", () => {
    expect(readRangeText(fakeTerm(["a", "b", "c"]), -5, 2)).toBe("a\nb\nc");
  });

  it("returns an empty string when every line is blank", () => {
    expect(readRangeText(fakeTerm(["", ""]), 0, 1)).toBe("");
  });

  it("treats a missing line as empty", () => {
    expect(readRangeText(fakeTerm(["x0", undefined, "x2"]), 0, 2)).toBe(
      "x0\n\nx2",
    );
  });
});
