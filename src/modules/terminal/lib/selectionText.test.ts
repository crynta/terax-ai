import { describe, expect, it } from "vitest";
import { getSelectionText, detectWrapColumn, cellWidth } from "./selectionText";
import type { IBufferCell, IBufferLine, Terminal } from "@xterm/xterm";

function mockCell(code: number, width: number): IBufferCell {
  return { getCode: () => code, getWidth: () => width } as unknown as IBufferCell;
}

function mockLine(content: string, wrapped: boolean, cols: number): IBufferLine {
  const cells: IBufferCell[] = [];
  for (let i = 0; i < cols; i++) {
    cells.push(
      i < content.length
        ? mockCell(content.charCodeAt(i), 1)
        : mockCell(32, 1),
    );
  }
  return {
    isWrapped: wrapped,
    translateToString(trimRight: boolean, start?: number, end?: number) {
      let s = content;
      const fullLen = Math.max(content.length, cols);
      const padded = content + " ".repeat(Math.max(0, fullLen - content.length));
      if (start !== undefined || end !== undefined) {
        s = padded.slice(start ?? 0, end ?? padded.length);
      }
      if (trimRight) s = s.replace(/\s+$/, "");
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

describe("detectWrapColumn", () => {
  it("returns null for empty input", () => {
    expect(detectWrapColumn([], 80)).toBeNull();
  });

  it("returns null when no widths near cols", () => {
    expect(detectWrapColumn([5, 8, 12, 3], 80)).toBeNull();
  });

  it("returns mode when >=2 lines share a width near cols", () => {
    expect(detectWrapColumn([78, 78, 78, 45], 80)).toBe(78);
  });

  it("returns null when mode appears only once", () => {
    expect(detectWrapColumn([78, 45, 30], 80)).toBeNull();
  });

  it("falls back to max if it equals cols", () => {
    expect(detectWrapColumn([80, 20, 5], 80)).toBe(80);
  });

  it("falls back to max if it equals cols-1", () => {
    expect(detectWrapColumn([79, 20, 5], 80)).toBe(79);
  });

  it("ignores empty lines (zero width)", () => {
    expect(detectWrapColumn([78, 0, 78, 30], 80)).toBe(78);
  });

  it("prefers mode over max", () => {
    expect(detectWrapColumn([80, 78, 78, 78], 80)).toBe(78);
  });
});

describe("getSelectionText", () => {
  it("returns null when no selection", () => {
    expect(getSelectionText(mockTerm([], undefined))).toBeNull();
  });

  it("returns single-line selection as-is", () => {
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

  // ====== xterm.js native soft wraps ======
  it("joins isWrapped=true lines without space", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 1 } },
    );
    expect(getSelectionText(term)).toBe("abcdef");
  });

  // ====== Statistical W detection: TUI-rendered word wraps ======
  it("joins TUI-wrapped paragraph (3 lines all at W)", () => {
    // Three lines all ending at col 78 - clearly wrapped
    const line1 = "a".repeat(78);
    const line2 = "b".repeat(78);
    const line3 = "c".repeat(78);
    const term = mockTerm(
      [mockLine(line1, false, 80), mockLine(line2, false, 80), mockLine(line3, false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 78, y: 2 } },
      80,
    );
    expect(getSelectionText(term)).toBe(`${line1} ${line2} ${line3}`);
  });

  it("3-line paragraph (2 lines at W + last short line) joins all", () => {
    // Typical paragraph reflow: 2 wrapped lines + short last line.
    // After long2 at W, "short" is the continuation (paragraph's last line)
    const long1 = "a".repeat(78);
    const long2 = "b".repeat(78);
    const short = "short text";
    const term = mockTerm(
      [mockLine(long1, false, 80), mockLine(long2, false, 80), mockLine(short, false, 80)],
      { start: { x: 0, y: 0 }, end: { x: short.length, y: 2 } },
      80,
    );
    expect(getSelectionText(term)).toBe(`${long1} ${long2} ${short}`);
  });

  it("preserves empty line as paragraph break", () => {
    const long1 = "a".repeat(78);
    const long2 = "b".repeat(78);
    const term = mockTerm(
      [
        mockLine(long1, false, 80),
        mockLine("", false, 80),
        mockLine(long2, false, 80),
      ],
      { start: { x: 0, y: 0 }, end: { x: 78, y: 2 } },
      80,
    );
    // long1 ends at W, but next is empty: \n preserved; empty line preserved
    expect(getSelectionText(term)).toBe(`${long1}\n\n${long2}`);
  });

  it("code block: random line lengths → no W → all breaks preserved", () => {
    const term = mockTerm(
      [
        mockLine("function foo() {", false, 80),
        mockLine("  return 42;", false, 80),
        mockLine("}", false, 80),
      ],
      { start: { x: 0, y: 0 }, end: { x: 1, y: 2 } },
      80,
    );
    expect(getSelectionText(term)).toBe("function foo() {\n  return 42;\n}");
  });

  it("list items: paragraph markers prevent join even if prev at W", () => {
    const long = "a".repeat(78);
    const item1 = "- first item";
    const item2 = "- second item";
    const term = mockTerm(
      [mockLine(long, false, 80), mockLine(item1, false, 80), mockLine(item2, false, 80)],
      { start: { x: 0, y: 0 }, end: { x: item2.length, y: 2 } },
      80,
    );
    // No W detected (only 1 line at width 78, others much shorter)
    expect(getSelectionText(term)).toBe(`${long}\n${item1}\n${item2}`);
  });

  it("numbered list as paragraph marker", () => {
    const w1 = "x".repeat(78);
    const w2 = "y".repeat(78);
    const item = "1. step one";
    const term = mockTerm(
      [mockLine(w1, false, 80), mockLine(w2, false, 80), mockLine(item, false, 80)],
      { start: { x: 0, y: 0 }, end: { x: item.length, y: 2 } },
      80,
    );
    // w1 and w2 join (both at W=78), then \n before "1. step" (paragraph marker)
    expect(getSelectionText(term)).toBe(`${w1} ${w2}\n${item}`);
  });

  it("bullet (U+2022) as paragraph marker", () => {
    const w1 = "x".repeat(78);
    const w2 = "y".repeat(78);
    const item = "\u2022 bullet";
    const term = mockTerm(
      [mockLine(w1, false, 80), mockLine(w2, false, 80), mockLine(item, false, 80)],
      { start: { x: 0, y: 0 }, end: { x: item.length, y: 2 } },
      80,
    );
    expect(getSelectionText(term)).toBe(`${w1} ${w2}\n${item}`);
  });

  it("two long lines at cols (max-fallback): join", () => {
    const w1 = "a".repeat(80);
    const w2 = "b".repeat(80);
    const term = mockTerm(
      [mockLine(w1, false, 80), mockLine(w2, false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 80, y: 1 } },
      80,
    );
    // Mode is 80 (>=2 lines), close to cols → W=80
    expect(getSelectionText(term)).toBe(`${w1} ${w2}`);
  });

  it("two short lines: no W → preserve break", () => {
    const term = mockTerm(
      [mockLine("hello", false, 80), mockLine("world", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 5, y: 1 } },
      80,
    );
    expect(getSelectionText(term)).toBe("hello\nworld");
  });

  it("git log style: only 1 long line + 1 short → no join (mode needs >=2)", () => {
    const w1 = "abc1234 (HEAD) A very long commit message that fills almost the line!"; // 70 chars
    const w2 = "def5678 Short msg";
    const term = mockTerm(
      [mockLine(w1, false, 80), mockLine(w2, false, 80)],
      { start: { x: 0, y: 0 }, end: { x: w2.length, y: 1 } },
      80,
    );
    // w1 is 70 chars, less than cols-1, no mode (1 line at 70, 1 at 17), no fallback
    expect(getSelectionText(term)).toBe(`${w1}\n${w2}`);
  });

  // ====== mixed: soft wrap + statistical ======
  it("isWrapped soft wraps still join (independent of W)", () => {
    const term = mockTerm(
      [mockLine("abc", false, 80), mockLine("def", true, 80), mockLine("ghi", false, 80)],
      { start: { x: 0, y: 0 }, end: { x: 3, y: 2 } },
    );
    // soft wrap joins abc+def, then break before ghi (no W)
    expect(getSelectionText(term)).toBe("abcdef\nghi");
  });

  it("returns null when no lines in range", () => {
    const term = mockTerm([], { start: { x: 0, y: 5 }, end: { x: 0, y: 7 } });
    expect(getSelectionText(term)).toBeNull();
  });
});

describe("cellWidth", () => {
  it("counts ASCII as 1", () => {
    expect(cellWidth("hello")).toBe(5);
  });
  it("counts CJK as 2", () => {
    expect(cellWidth("中文")).toBe(4);
  });
  it("mixed CJK and ASCII", () => {
    expect(cellWidth("abc中文")).toBe(7);
  });
});
