import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { cursorPosition } from "./cursorReporter";

function at(doc: string, selection: EditorSelection, tabSize = 4) {
  return cursorPosition(
    EditorState.create({
      doc,
      selection,
      extensions: EditorState.tabSize.of(tabSize),
    }),
  );
}

const cursor = (offset: number) => EditorSelection.single(offset);

describe("cursorPosition", () => {
  it("starts at line 1, column 1", () => {
    expect(at("abc", cursor(0))).toEqual({ line: 1, col: 1 });
  });

  it("counts lines and columns from 1", () => {
    expect(at("ab\ncdef", cursor(5))).toEqual({ line: 2, col: 3 });
  });

  it("expands tabs to the next tab stop of the file's tab size", () => {
    expect(at("\tx", cursor(1))).toEqual({ line: 1, col: 5 });
    expect(at("ab\tx", cursor(3))).toEqual({ line: 1, col: 5 });
    expect(at("\tx", cursor(1), 2)).toEqual({ line: 1, col: 3 });
  });

  it("counts a character made of several code units as one column", () => {
    expect(at("😀x", cursor(2))).toEqual({ line: 1, col: 2 });
  });

  it("follows the selection head, not the anchor", () => {
    expect(at("abcdef", EditorSelection.single(0, 4))).toEqual({
      line: 1,
      col: 5,
    });
    expect(at("abcdef", EditorSelection.single(4, 0))).toEqual({
      line: 1,
      col: 1,
    });
  });
});
