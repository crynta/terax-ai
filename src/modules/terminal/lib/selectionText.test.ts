import { describe, expect, it } from "vitest";
import { getSelectionText } from "./selectionText";
import type { IBufferCell, IBufferLine, Terminal } from "@xterm/xterm";

// --- Mock infrastructure ---

function mockCell(code: number, width: number): IBufferCell {
  return {
    getCode: () => code,
    getWidth: () => width,
  } as unknown as IBufferCell;
}

/**
 * Create a mock IBufferLine.
 * @param content  The actual text content (characters written by the program)
 * @param wrapped  isWrapped flag
 * @param cols     Terminal column count
 * @param trailingSpaces  Number of explicit trailing spaces AFTER content
 *                         (these are written by the program, e.g. word-boundary padding)
 *
 * Cell layout: [content chars][trailing spaces][empty cells = code 32, width 1]
 * - Content chars: code = charCode, width = 1
 * - Trailing spaces: code = 32, width = 1
 * - Empty cells: code = 32, width = 1 (xterm.js default)
 *
 * Note: In xterm.js, ALL cells default to space (code=32, width=1).
 * We cannot distinguish "program wrote a space" from "empty cell" via getCode.
 * The ONLY distinguishable signal is getCode() > 32 at the last cell
 * (meaning content fills to the column boundary with a non-space char).
 */
function mockLine(
  content: string,
  wrapped: boolean,
  cols: number,
  trailingSpaces = 0,
): IBufferLine {
  const fullContent = content + " ".repeat(trailingSpaces);
  const cells: IBufferCell[] = [];
  for (let i = 0; i < cols; i++) {
    if (i < fullContent.length) {
      // Written cell: content char or explicit space
      cells.push(mockCell(fullContent.charCodeAt(i), 1));
    } else {
      // Empty cell: xterm.js fills with space
      cells.push(mockCell(32, 1));
    }
  }
  return {
    isWrapped: wrapped,
    translateToString(trimRight: boolean, start?: number, end?: number) {
      let s = fullContent;
      if (trimRight) s = s.trimEnd();
      if (start !== undefined && end !== undefined) s = s.slice(start, end);
      else if (start !== undefined) s = s.slice(start);
      return s;
    },
    getCell: (x: number) => (x >= 0 && x < cells.length ? cells[x] : undefined),
    length: cols,
  } as unknown as IBufferLine;
}

function mockTerm(
  lines: IBufferLine[],
  selection:
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined,
  cols = 80,
) {
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
  } as unknown as Terminal;
}

// --- Tests ---

describe("getSelectionText", () => {
  // ====== NO SELECTION ======

  it("returns null when no selection", () => {
    expect(getSelectionText(mockTerm([], undefined))).toBeNull();
  });

  // ====== SINGLE LINE ======

  it("returns full single-line selection", () => {
    const term = mockTerm([mockLine("hello", false, 80)], {
      start: { x: 0, y: 0 }, end: { x: 5, y: 0 },
    });
    expect(getSelectionText(term)).toBe("hello");
  });

  it("returns partial single-line selection", () => {
    const term = mockTerm([mockLine("hello world", false, 80)], {
      start: { x: 2, y: 0 }, end: { x: 7, y: 0 },
    });
    expect(getSelectionText(term)).toBe("llo w");
  });

  // ====== SOFT WRAPS (isWrapped=true) ======

  it("joins soft-wrapped lines without newline", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("abcdef");
  });

  it("joins 3 consecutive soft-wrapped rows", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80), mockLine("ghi", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abcdefghi");
  });

  it("soft-wrapped then real line: join soft, break at real", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80), mockLine("ghi", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abcdef\nghi");
  });

  // ====== SHORT REAL LINES (should NOT be joined) ======

  it("separates two short real lines", () => {
    const term = mockTerm(
      [mockLine("ls", false, 80), mockLine("cd", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("ls\ncd");
  });

  it("preserves empty line between content", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("abc\n\ndef");
  });

  it("preserves end.x=0 on last line", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 0, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("abc\n");
  });

  // ====== HARD WRAP: mid-word (last cell has content char, code > 32) ======

  it("joins mid-word hard-wrapped lines when last cell is content", () => {
    // "abcdefghij" fills cols=10 exactly, last cell 'j' code=106 > 32
    // Next line also fills cols exactly
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqrst", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    // Mid-word wrap: space added (conservative default)
    expect(getSelectionText(term)).toBe("abcdefghij klmnopqrst");
  });

  it("detects hard wrap when selection starts mid-line (lastCellContent)", () => {
    // Full line fills cols, selection starts from col 5
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnopqr", false, 10)],
      { start: { x: 5, y: 0 }, end: { x: 8, y: 1 } },
      10,
    );
    // parts[0].text = "fghij", but full line fills cols → join
    expect(getSelectionText(term)).toBe("fghij klmnopqr");
  });

  // ====== HARD WRAP: word-boundary (trailing spaces, last cell = space) ======

  it("joins word-boundary hard-wrapped lines where fullCw >= 60% cols", () => {
    // "abcdefgh" + 2 trailing spaces, cols=10. fullCw=8 >= 6
    // "ijklmnop" + 2 trailing spaces, fullCw=8 >= 6
    const term = mockTerm(
      [mockLine("abcdefgh", false, 10, 2), mockLine("ijklmnop", false, 10, 2)],
      { start: { x: 0, y: 0 }, end: { x: 10, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefgh ijklmnop");
  });

  it("does NOT join when fullCw < 60% of cols (short real line)", () => {
    // "ab" + empty, cols=80. fullCw=2 < 48
    const term = mockTerm(
      [mockLine("ab", false, 80), mockLine("cd", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 2, y: 1 } },
      80,
    );
    expect(getSelectionText(term)).toBe("ab\ncd");
  });

  it("detects word-boundary hard wrap from full line even when selection starts mid-line", () => {
    // Full line: "abcdefgh" + 2 spaces, cols=10, fullCw=8 >= 6
    // Selection starts from col 3 → parts[0].text = "defgh  "
    // fullCw is from FULL line (not selected portion)
    const term = mockTerm(
      [mockLine("abcdefgh", false, 10, 2), mockLine("ijkl", false, 10)],
      { start: { x: 3, y: 0 }, end: { x: 4, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("defgh ijkl");
  });

  // ====== HARD WRAP: paragraph breaks (should NOT join) ======

  it("does not join before blank line even if prev fills cols", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("", false, 10), mockLine("next", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 4, y: 2 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n\nnext");
  });

  it("does not join before list marker '- ' even if prev fills cols", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("- item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n- item");
  });

  it("does not join before list marker '* '", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("* item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n* item");
  });

  it("does not join before bullet marker", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("\u2022 item", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij\n\u2022 item");
  });

  // ====== HARD WRAP: mixed chain ======

  it("joins a chain of hard-wrapped lines, keeps real break at end", () => {
    // Line 0: fills cols (hard-wrapped)
    // Line 1: fills cols (hard-wrapped)
    // Line 2: short (real paragraph ending)
    // Line 3: start of new paragraph (short)
    const term = mockTerm(
      [
        mockLine("abcdefghij", false, 10), // hard-wrapped
        mockLine("klmnopqrst", false, 10), // hard-wrapped
        mockLine("uv", false, 10),         // last line of paragraph (short)
        mockLine("New para", false, 10),   // new paragraph (short)
      ],
      { start: { x: 0, y: 0 }, end: { x: 8, y: 3 } },
      10,
    );
    // 0→1: join (hard-wrapped), 1→2: join (hard-wrapped), 2→3: break (short)
    expect(getSelectionText(term)).toBe("abcdefghij klmnopqrst uv\nNew para");
  });

  // ====== HARD WRAP: indentation trimming ======

  it("trims indentation on continuation lines of hard-wrapped text", () => {
    // Line 0: "abcdefgh" + 2 trailing spaces, cols=10, fullCw=8 >= 6
    // Line 1: "    ijkl" (4-space indent + content)
    const term = mockTerm(
      [mockLine("abcdefgh", false, 10, 2), mockLine("    ijkl", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 8, y: 1 } },
      10,
    );
    // "abcdefgh" trimmed + space + "ijkl" (indentation trimmed)
    expect(getSelectionText(term)).toBe("abcdefgh ijkl");
  });

  // ====== HARD WRAP: CJK ======

  it("CJK line filling cols exactly is detected as hard-wrapped", () => {
    // We can't easily mock CJK in our mockLine, but we can test the fullCw path.
    // Create a line where content width (with CJK) >= cols.
    // For mock purposes, a line that fills cols exactly (like mid-word) works:
    const term = mockTerm(
      [mockLine("abcdefghij", false, 10), mockLine("klmnop", false, 10)],
      { start: { x: 0, y: 0 }, end: { x: 6, y: 1 } },
      10,
    );
    expect(getSelectionText(term)).toBe("abcdefghij klmnop");
  });

  // ====== REAL-LIFE SCENARIOS ======

  it("git log: soft-wrapped long line + new commit (real break)", () => {
    const term = mockTerm(
      [
        mockLine("abc1234 (HEAD) A very long commit message t", false, 80),
        mockLine("hat wraps across the terminal width", true, 80),
        mockLine("def5678 Fix something", false, 80),
      ],
      { start: { x: 0, y: 0 }, end: { x: 21, y: 2 } },
    );
    expect(getSelectionText(term)).toBe(
      "abc1234 (HEAD) A very long commit message that wraps across the terminal width\ndef5678 Fix something",
    );
  });

  // ====== EDGE CASES ======

  it("returns null when all lines in range are undefined", () => {
    const term = mockTerm([], {
      start: { x: 0, y: 5 }, end: { x: 0, y: 7 },
    });
    expect(getSelectionText(term)).toBeNull();
  });

  it("handles partial columns across soft-wrapped and real lines", () => {
    const term = mockTerm(
      [mockLine("abcdefghij", false, 80), mockLine("klmnopqrst", true, 80), mockLine("uvwxyz", false, 80)],
      { start: { x: 2, y: 0 }, end: { x: 5, y: 2 } },
    );
    expect(getSelectionText(term)).toBe("cdefghijklmnopqrst\nuvwxy");
  });
});