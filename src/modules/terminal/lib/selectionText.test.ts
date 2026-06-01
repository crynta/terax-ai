import { describe, expect, it } from "vitest";
import { getSelectionText } from "./selectionText";
import type { Terminal } from "@xterm/xterm";

type MockLine = {
  isWrapped: boolean;
  translateToString: (trimRight: boolean, start?: number, end?: number) => string;
};

function mockLine(text: string, wrapped: boolean): MockLine {
  return {
    isWrapped: wrapped,
    translateToString(trimRight: boolean, start?: number, end?: number) {
      let s = text;
      if (trimRight) s = s.trimEnd();
      if (start !== undefined && end !== undefined) s = s.slice(start, end);
      else if (start !== undefined) s = s.slice(start);
      return s;
    },
  };
}

type MockTerm = {
  hasSelection: () => boolean;
  getSelectionPosition: () =>
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined;
  buffer: { active: { getLine: (y: number) => MockLine | undefined } };
};

function mockTerm(
  lines: MockLine[],
  selection:
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined,
): MockTerm {
  return {
    hasSelection: () => selection !== undefined,
    getSelectionPosition: () => selection,
    buffer: {
      active: {
        getLine: (y: number) =>
          y >= 0 && y < lines.length ? lines[y] : undefined,
      },
    },
  };
}

describe("getSelectionText", () => {
  // --- no selection ---

  it("returns null when getSelectionPosition is undefined", () => {
    const term = mockTerm([], undefined);
    expect(getSelectionText(term as unknown as Terminal)).toBeNull();
  });

  // --- single line ---

  it("returns single-line full selection", () => {
    const term = mockTerm([mockLine("hello world", false)], {
      start: { x: 0, y: 0 },
      end: { x: 11, y: 0 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("hello world");
  });

  it("returns single-line partial selection using column bounds", () => {
    const term = mockTerm([mockLine("hello world", false)], {
      start: { x: 2, y: 0 },
      end: { x: 7, y: 0 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("llo w");
  });

  it("handles zero-width selection on a single line", () => {
    const term = mockTerm([mockLine("hello", false)], {
      start: { x: 3, y: 0 },
      end: { x: 3, y: 0 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("");
  });

  // --- two real lines ---

  it("separates two real lines with newline", () => {
    const term = mockTerm([mockLine("abc  ", false), mockLine("def  ", false)], {
      start: { x: 0, y: 0 },
      end: { x: 3, y: 1 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\ndef");
  });

  // --- two wrapped visual lines ---

  it("joins wrapped lines without newline", () => {
    const term = mockTerm([mockLine("abc  ", false), mockLine("def  ", true)], {
      start: { x: 0, y: 0 },
      end: { x: 3, y: 1 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdef");
  });

  // --- mixed wrapped and real breaks ---

  it("handles real line followed by wrapped continuation then real line", () => {
    const term = mockTerm(
      [mockLine("abc  ", false), mockLine("def  ", true), mockLine("ghi  ", false)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdef\nghi");
  });

  // --- multi-segment wrapping ---

  it("joins 3 wrapped visual rows into one line", () => {
    const term = mockTerm(
      [mockLine("abc  ", false), mockLine("def  ", true), mockLine("ghi  ", true)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghi");
  });

  // --- partial columns across lines ---

  it("handles partial column selection on first and last line", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false), mockLine("klmnopqrst", false)],
      { start: { x: 2, y: 0 }, end: { x: 5, y: 1 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("cdefghij\nklmno");
  });

  it("handles partial column selection across wrapped and real lines", () => {
    const term = mockTerm(
      [
        mockLine("abcdefghij", false),
        mockLine("klmnopqrst", true),
        mockLine("uvwxyz", false),
      ],
      { start: { x: 2, y: 0 }, end: { x: 5, y: 2 } },
    );
    // line0 from 2, line1 full (wrapped, joined), line2 to 5
    expect(getSelectionText(term as unknown as Terminal)).toBe(
      "cdefghijklmnopqrst\nuvwxy",
    );
  });

  // --- empty lines ---

  it("handles empty real line between content", () => {
    const term = mockTerm(
      [mockLine("abc", false), mockLine("", false), mockLine("def", false)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\n\ndef");
  });

  it("handles empty wrapped line treated as continuation", () => {
    const term = mockTerm(
      [mockLine("abc", false), mockLine("", true), mockLine("def", false)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    // line1 is wrapped → join without \n, then line2 real → \n
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\ndef");
  });

  // --- end.x = 0 on last line ---

  it("handles end.x = 0 on last line (nothing selected from last row)", () => {
    const term = mockTerm(
      [mockLine("abc", false), mockLine("def", false)],
      { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    );
    // line0 full, line1 from 0 to 0 → ""
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\n");
  });

  // --- getLine returns undefined for gap in buffer ---

  it("skips buffer lines that return undefined", () => {
    const term = mockTerm(
      [mockLine("abc", false), mockLine("def", false)],
      // Request y=0..2 but only 2 lines exist (y=2 returns undefined)
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\ndef");
  });

  it("returns null when all lines in range return undefined", () => {
    const term = mockTerm([], {
      start: { x: 0, y: 5 },
      end: { x: 0, y: 7 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBeNull();
  });

  // --- first line is a wrapped continuation (isWrapped=true) ---

  it("when first line is itself wrapped, still concatenates without leading newline", () => {
    // Real scenario: user starts selection mid-wrap. The first selected
    // line has isWrapped=true meaning it continues from a line above the selection.
    const term = mockTerm(
      [mockLine("def", true), mockLine("ghi", false)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    // line0 isWrapped=true so when we encounter line1 with isWrapped=false,
    // we insert \n before line1. Result: "def\nghi"
    expect(getSelectionText(term as unknown as Terminal)).toBe("def\nghi");
  });

  // --- real-world git log scenario ---

  it("real-life: long git log line wrapped then a new commit line", () => {
    const term = mockTerm(
      [
        mockLine("abc1234 (HEAD -> main) A very long commit message that wraps ac", false),
        mockLine("ross the terminal width due to being too long", true),
        mockLine("def5678 Fix something", false),
      ],
      { start: { x: 0, y: 0 }, end: { x: 21, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe(
      "abc1234 (HEAD -> main) A very long commit message that wraps across the terminal width due to being too long\ndef5678 Fix something",
    );
  });
});