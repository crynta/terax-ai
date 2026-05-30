import { describe, expect, it } from "vitest";
import { getSelectionText } from "./selectionText";
import type { Terminal } from "@xterm/xterm";
import type { IBufferCell, IBufferLine } from "@xterm/xterm";

function mockCell(code: number, width: number): IBufferCell {
  return {
    getCode: () => code,
    getWidth: () => width,
    getChars: () => (code === 0 ? "" : String.fromCodePoint(code)),
  } as unknown as IBufferCell;
}

function mockLine(
  text: string,
  wrapped: boolean,
  cols: number,
): IBufferLine {
  // Build cells: each ASCII char = 1 cell, no CJK in mock for simplicity
  const cells: IBufferCell[] = [];
  for (let i = 0; i < cols; i++) {
    if (i < text.length) {
      cells.push(mockCell(text.charCodeAt(i), 1));
    } else {
      // Empty cell after text: code=0 means never written
      // If line "fills cols", the text should be exactly cols chars,
      // or trailing spaces should be explicit (code=32)
      cells.push(mockCell(0, 1));
    }
  }
  return {
    isWrapped: wrapped,
    translateToString(trimRight: boolean, start?: number, end?: number) {
      let s = text;
      if (trimRight) s = s.trimEnd();
      if (start !== undefined && end !== undefined) s = s.slice(start, end);
      else if (start !== undefined) s = s.slice(start);
      return s;
    },
    getCell: (x: number) => (x >= 0 && x < cells.length ? cells[x] : undefined),
    length: cols,
  } as unknown as IBufferLine;
}

type MockTerm = {
  hasSelection: () => boolean;
  getSelectionPosition: () =>
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined;
  buffer: { active: { getLine: (y: number) => IBufferLine | undefined } };
  cols: number;
};

function mockTerm(
  lines: IBufferLine[],
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
    const term = mockTerm([mockLine("hello world", false, 80)], {
      start: { x: 0, y: 0 },
      end: { x: 11, y: 0 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("hello world");
  });

  it("returns single-line partial selection", () => {
    const term = mockTerm([mockLine("hello world", false, 80)], {
      start: { x: 2, y: 0 },
      end: { x: 7, y: 0 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("llo w");
  });

  // --- two real lines ---

  it("separates two real lines with newline", () => {
    const term = mockTerm(
      [mockLine("abc  ", false, 80), mockLine("def  ", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\ndef");
  });

  // --- two wrapped visual lines ---

  it("joins wrapped lines without newline", () => {
    const term = mockTerm(
      [mockLine("abc  ", false, 80), mockLine("def  ", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdef");
  });

  // --- mixed wrapped and real breaks ---

  it("handles real line then wrapped then real line", () => {
    const term = mockTerm(
      [mockLine("abc  ", false, 80), mockLine("def  ", true, 80), mockLine("ghi  ", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdef\nghi");
  });

  // --- 3 wrapped rows ---

  it("joins 3 wrapped rows into one line", () => {
    const term = mockTerm(
      [mockLine("abc  ", false, 80), mockLine("def  ", true, 80), mockLine("ghi  ", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghi");
  });

  // --- partial columns across lines ---

  it("handles partial columns across wrapped and real lines", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 80), mockLine("klmnopqrst", true, 80), mockLine("uvwxyz", false, 80)],
      { start: { x: 2, y: 0 }, end: { x: 5, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe(
      "cdefghijklmnopqrst\nuvwxy",
    );
  });

  // --- empty lines ---

  it("handles empty real line between content", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\n\ndef");
  });

  // --- end.x = 0 on last line ---

  it("handles end.x = 0 on last line", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\n");
  });

  // --- buffer gap ---

  it("returns null when all lines in range return undefined", () => {
    const term = mockTerm([], {
      start: { x: 0, y: 5 },
      end: { x: 0, y: 7 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBeNull();
  });

  // --- hard-wrapped lines (fills cols) ---

  it("joins hard-wrapped lines that fill terminal width", () => {
    // 10 chars, cols=10, all cells filled → fillsCols=true
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqrst", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghijklmnopqrst");
  });

  it("does not join short lines", () => {
    // "ls" = 2 chars, cols=80, empty cells after → fillsCols=false
    const term = mockTerm(
      [mockLine("ls", false, 80), mockLine("cd", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
      80,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("ls\ncd");
  });

  it("joins hard-wrapped lines with trailing spaces (word-boundary wrap)", () => {
    // Line fills cols with trailing spaces: "hello     " (10 chars, cols=10)
    const term = mockTerm(
      [mockLine("hello     ", false, 10), mockLine("world     ", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    // "hello     " fills cols, trailing spaces → trim + add space
    // "world     " fills cols, trailing spaces on prev → trim + add space
    expect(getSelectionText(term as unknown as Terminal)).toBe("hello world");
  });

  it("does not join before blank line even if prev fills cols", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("", false, 10), mockLine("next", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 4, y: 2 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghij\n\nnext");
  });

  it("does not join before list marker even if prev fills cols", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("- item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghij\n- item");
  });

  it("hard-wrap detected when selection starts mid-line", () => {
    // Full line fills cols, but selection starts from col 5
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnop", false, 10)],
      { start: { x: 5, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    // Line 0 fills cols → hard-wrapped. Selection gets "fghij".
    // Next line "klmnop" doesn't fill cols → joined because prev fills cols.
    expect(getSelectionText(term as unknown as Terminal)).toBe("fghijklmnop");
  });

  // --- real-life git log ---

  it("real-life: long git log line wrapped then new commit", () => {
    const term = mockTerm(
      [mockLine("abc1234 (HEAD -> main) A very long commit message tha", false, 80), mockLine("t wraps across the terminal width", true, 80), mockLine("def5678 Fix something", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 21, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe(
      "abc1234 (HEAD -> main) A very long commit message that wraps across the terminal width\ndef5678 Fix something",
    );
  });
});