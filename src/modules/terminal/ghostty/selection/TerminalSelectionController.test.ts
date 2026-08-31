import { describe, expect, it } from "vitest";
import type { TerminalBufferSelection } from "../GhosttyTerminalModel";
import {
  normalizeSelection,
  selectionContains,
  shouldStartTerminalSelection,
} from "./TerminalSelectionController";

describe("terminal selection pointer ownership", () => {
  it("does not capture a pointer already claimed by a resize separator", () => {
    expect(
      shouldStartTerminalSelection(
        {
          button: 0,
          defaultPrevented: true,
          shiftKey: false,
          target: null,
        },
        () => false,
        false,
      ),
    ).toBe(false);
  });

  it("keeps Shift selection available when an application tracks the mouse", () => {
    expect(
      shouldStartTerminalSelection(
        {
          button: 0,
          defaultPrevented: false,
          shiftKey: true,
          target: null,
        },
        () => false,
        true,
      ),
    ).toBe(true);
  });
});

describe("terminal selection geometry", () => {
  it("normalizes backward selections", () => {
    expect(
      normalizeSelection({
        anchor: { line: 8, column: 2 },
        focus: { line: 3, column: 7 },
        rectangular: false,
      }),
    ).toEqual({
      start: { line: 3, column: 7 },
      end: { line: 8, column: 2 },
      left: 2,
      right: 7,
    });
  });

  it("matches linear selections across row boundaries", () => {
    const selection: TerminalBufferSelection = {
      anchor: { line: 3, column: 7 },
      focus: { line: 5, column: 2 },
      rectangular: false,
    };
    expect(selectionContains(selection, { line: 3, column: 6 })).toBe(false);
    expect(selectionContains(selection, { line: 3, column: 7 })).toBe(true);
    expect(selectionContains(selection, { line: 4, column: 0 })).toBe(true);
    expect(selectionContains(selection, { line: 5, column: 2 })).toBe(true);
    expect(selectionContains(selection, { line: 5, column: 3 })).toBe(false);
  });

  it("matches rectangular selections in either drag direction", () => {
    const selection: TerminalBufferSelection = {
      anchor: { line: 5, column: 8 },
      focus: { line: 2, column: 3 },
      rectangular: true,
    };
    expect(selectionContains(selection, { line: 2, column: 3 })).toBe(true);
    expect(selectionContains(selection, { line: 4, column: 6 })).toBe(true);
    expect(selectionContains(selection, { line: 5, column: 9 })).toBe(false);
    expect(selectionContains(selection, { line: 1, column: 6 })).toBe(false);
  });
});
