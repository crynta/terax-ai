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
  cols: number;
};

function mockTerm(
  lines: MockLine[],
  selection:
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined,
  cols = 80,
): MockTerm {
  return {
    hasSelection: () => selection !== undefined,
    getSelectionPosition: () => selection,
    cols,
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
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\ndef");
  });

  // --- end.x = 0 on last line ---

  it("handles end.x = 0 on last line (nothing selected from last row)", () => {
    const term = mockTerm(
      [mockLine("abc", false), mockLine("def", false)],
      { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\n");
  });

  // --- getLine returns undefined for gap in buffer ---

  it("skips buffer lines that return undefined", () => {
    const term = mockTerm(
      [mockLine("abc", false), mockLine("def", false)],
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
    const term = mockTerm(
      [mockLine("def", true), mockLine("ghi", false)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
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

  // --- hard-wrapped lines (isWrapped=false but len >= cols) ---

  it("joins hard-wrapped lines where line fills terminal width", () => {
    // Pi CLI outputs text with \n at terminal width (cols=10)
    // "abcdefghij" fills exactly 10 cols, next line is a continuation
    const term = mockTerm(
      [mockLine("abcdefghij", false), mockLine("klmnopqrst", false)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghijklmnopqrst");
  });

  it("joins hard-wrapped lines that slightly underfill (len = cols - 1)", () => {
    // Some TUIs add \n when text reaches cols-1 (leaving room for cursor)
    // "abcdefghi" is 9 chars, cols=10 → len < cols, NOT hard-wrapped
    const term = mockTerm(
      [mockLine("abcdefghi", false), mockLine("jklmnopqr", false)],
      { start: { x: 0, y: 0 }, end: { x: 9, y: 1 } },
      10,
    );
    // len=9 < cols=10, so this is NOT a hard wrap → preserve \n
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghi\njklmnopqr");
  });

  it("does not join hard-wrapped line before blank line", () => {
    // A line that fills width followed by blank → paragraph break
    const term = mockTerm(
      [mockLine("abcdefghij", false), mockLine("", false), mockLine("next paragraph", false)],
      { start: { x: 0, y: 0 }, end: { x: 14, y: 2 } },
      10,
    );
    // line0 fills cols → hard-wrapped, but line1 is blank → paragraph break
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghij\n\nnext paragraph");
  });

  it("does not join hard-wrapped line before list marker", () => {
    // A line that fills width followed by a list marker → real break
    const term = mockTerm(
      [mockLine("abcdefghij", false), mockLine("- item one", false)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghij\n- item one");
  });

  it("handles mixed hard-wrapped and soft-wrapped lines", () => {
    // Line 0: hard-wrapped (len=cols, isWrapped=false)
    // Line 1: soft-wrapped (isWrapped=true)
    // Line 2: real break (isWrapped=false, short)
    const term = mockTerm(
      [mockLine("abcdefghij", false), mockLine("klmnopqrst", true), mockLine("uvwx", false)],
      { start: { x: 0, y: 0 }, end: { x: 4, y: 2 } },
      10,
    );
    // line0 fills cols → hard-wrapped, line1 isWrapped → joined
    // line2 short + not wrapped → real break
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghijklmnopqrst\nuvwx");
  });

  it("preserves short real lines between hard-wrapped content", () => {
    // Two short commands on separate lines should NOT be joined
    const term = mockTerm(
      [mockLine("ls", false), mockLine("cd", false)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
      80,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("ls\ncd");
  });
});