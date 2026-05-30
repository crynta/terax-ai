import { describe, expect, it } from "vitest";
import { getSelectionText } from "./selectionText";
import type { Terminal, IBufferCell, IBufferLine } from "@xterm/xterm";

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
  trailingSpaces = 0,
): IBufferLine {
  const fullText = text + " ".repeat(trailingSpaces);
  const cells: IBufferCell[] = [];
  for (let i = 0; i < cols; i++) {
    if (i < fullText.length) {
      cells.push(mockCell(fullText.charCodeAt(i), 1));
    } else {
      cells.push(mockCell(32, 1)); // empty cell = space
    }
  }
  return {
    isWrapped: wrapped,
    translateToString(trimRight: boolean, start?: number, end?: number) {
      let s = fullText;
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
  it("returns null when no selection", () => {
    const term = mockTerm([], undefined);
    expect(getSelectionText(term as unknown as Terminal)).toBeNull();
  });

  it("returns single-line selection", () => {
    const term = mockTerm([mockLine("hello world", false, 80)], {
      start: { x: 0, y: 0 }, end: { x: 11, y: 0 },
    });
    expect(getSelectionText(term as unknown as Terminal)).toBe("hello world");
  });

  it("separates two short real lines with newline", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\ndef");
  });

  it("joins soft-wrapped lines without newline", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdef");
  });

  it("preserves empty real line between content", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abc\n\ndef");
  });

  // --- hard-wrapped: mid-word (last cell has content, code > 32) ---

  it("joins mid-word hard-wrapped lines (last cell has content)", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqrst", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghij klmnopqrst");
  });

  // --- hard-wrapped: word-boundary (trailing spaces, last cell = space) ---

  it("joins word-boundary hard-wrapped lines with space", () => {
    // "helloworld" fills cols=10, lastCell='d' code=100>32 → detected via lastCellContent
    const term = mockTerm(
      [mockLine("helloworld", false, 10), mockLine("nextline  ", false, 10, 2)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("helloworld nextline");
  });

  it("joins word-boundary hard-wrapped lines where fullCw >= 60% of cols", () => {
    // "abcdefgh" + 2 trailing spaces, cols=10. fullCw=8 >= 6
    // Next line "ijklmnop" + 2 trailing spaces, fullCw=8 >= 6
    const term = mockTerm(
      [mockLine("abcdefgh", false, 10, 2), mockLine("ijklmnop", false, 10, 2)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefgh ijklmnop");
  });

  it("does NOT join short real lines below 60% threshold", () => {
    // "ls" + 78 spaces (short line), cols=80. fullCw=2 < 48 (80*0.6)
    const term = mockTerm(
      [mockLine("ls", false, 80), mockLine("cd", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
      80,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("ls\ncd");
  });

  it("mid-word hard-wrap detected even when selection starts mid-line", () => {
    // "abcdefghij" fills cols=10, last cell = 'j'. Selection from col 5.
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnop", false, 10)],
      { start: { x: 5, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("fghij klmnop");
  });

  it("word-boundary hard-wrap from previous line detected for next line", () => {
    // Previous line mostly fills cols. "abcdefgh" + 2 spaces, cols=10, fullCw=8>=6
    // Next line "ijkl" short
    const term = mockTerm(
      [mockLine("abcdefgh", false, 10, 2), mockLine("ijkl", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 4, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefgh ijkl");
  });

  it("does not join before list marker even with hard-wrap", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("- item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghij\n- item");
  });

  it("does not join before blank line even with hard-wrap", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("", false, 10), mockLine("next", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 4, y: 2 } },
      10,
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe("abcdefghij\n\nnext");
  });

  it("real-life: long git log line soft-wrapped then new commit", () => {
    const term = mockTerm(
      [mockLine("abc1234 (HEAD) A very long commit message t", false, 80), mockLine("hat wraps across the terminal width", true, 80), mockLine("def5678 Fix something", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 21, y: 2 } },
    );
    expect(getSelectionText(term as unknown as Terminal)).toBe(
      "abc1234 (HEAD) A very long commit message that wraps across the terminal width\ndef5678 Fix something",
    );
  });
});