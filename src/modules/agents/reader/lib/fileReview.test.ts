import { describe, expect, it } from "vitest";
import { changeAt, chunkStats, nextChange, saveDecision } from "./fileReview";

describe("saveDecision", () => {
  it("writes edits made on top of what the dialog last saw", () => {
    expect(saveDecision("a\n", "a\n", "b\n")).toBe("write");
    expect(saveDecision("a\n", "a\n", "a\n")).toBe("unchanged");
  });

  it("refuses to overwrite a file Claude changed in the meantime", () => {
    expect(saveDecision("claude\n", "a\n", "mine\n")).toBe("conflict");
    expect(saveDecision(null, "a\n", "mine\n")).toBe("conflict");
  });

  it("treats a disk change that already matches the editor as saved", () => {
    expect(saveDecision("same\n", "a\n", "same\n")).toBe("unchanged");
  });
});

describe("chunkStats", () => {
  it("counts whole lines on each side of every change", () => {
    const original = "import a;\nkeep;\n";
    const doc = "// mine\nimport a2;\nkeep;\n";
    // One change: line 1 before, lines 1-2 now.
    expect(
      chunkStats(original, doc, [{ fromA: 0, toA: 10, fromB: 0, toB: 19 }]),
    ).toEqual({ added: 2, removed: 1 });
    // A pure insertion removes nothing.
    expect(
      chunkStats("", "x\ny\n", [{ fromA: 0, toA: 0, fromB: 0, toB: 4 }]),
    ).toEqual({ added: 2, removed: 0 });
    expect(chunkStats("same\n", "same\n", [])).toEqual({
      added: 0,
      removed: 0,
    });
  });
});

describe("nextChange", () => {
  const starts = [10, 50, 90];
  it("steps to the next change after the cursor and wraps", () => {
    expect(nextChange(starts, 0, 1)).toBe(0);
    expect(nextChange(starts, 10, 1)).toBe(1);
    expect(nextChange(starts, 95, 1)).toBe(0);
  });

  it("steps back to the change before the cursor and wraps", () => {
    expect(nextChange(starts, 60, -1)).toBe(1);
    expect(nextChange(starts, 5, -1)).toBe(2);
    expect(nextChange([], 5, -1)).toBe(-1);
  });
});

describe("changeAt", () => {
  it("finds the change the cursor is in", () => {
    const ranges = [
      { from: 10, to: 20 },
      { from: 40, to: 45 },
    ];
    expect(changeAt(ranges, 15)).toBe(0);
    expect(changeAt(ranges, 45)).toBe(1);
    expect(changeAt(ranges, 30)).toBe(-1);
  });
});
