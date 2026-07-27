import { describe, expect, it } from "vitest";
import { imeReconstruct } from "./ime";

// Apply a PTY byte stream (text + DEL erases) to a line buffer the way a line
// editor would, so a sequence of steps can be asserted against the final line.
function applyToLine(line: string, send: string): string {
  const buf = [...line];
  for (const ch of send) {
    if (ch === "\x7f") buf.pop();
    else buf.push(ch);
  }
  return buf.join("");
}

describe("imeReconstruct", () => {
  it("appends a new unit on insertText", () => {
    expect(imeReconstruct("", "insertText", "ㅇ")).toEqual({
      send: "ㅇ",
      unit: "ㅇ",
    });
  });

  it("erases the previous unit and resends on insertReplacementText", () => {
    expect(imeReconstruct("ㅇ", "insertReplacementText", "아")).toEqual({
      send: "\x7f아",
      unit: "아",
    });
  });

  it("skips a duplicate replacement with identical data (no flicker)", () => {
    expect(imeReconstruct("잘", "insertReplacementText", "잘")).toBeNull();
  });

  it("replaces the previous unit on insertCompositionText (composition model)", () => {
    // Opening a syllable: nothing to erase yet.
    expect(imeReconstruct("", "insertCompositionText", "ㅇ")).toEqual({
      send: "ㅇ",
      unit: "ㅇ",
    });
    // Refining it must erase the leading jamo, not append after it.
    expect(imeReconstruct("ㅇ", "insertCompositionText", "아")).toEqual({
      send: "\x7f아",
      unit: "아",
    });
  });

  it("commits composed text without re-writing when already on screen", () => {
    expect(imeReconstruct("아", "insertFromComposition", "아")).toEqual({
      send: "",
      unit: "",
    });
  });

  it("ignores deleteCompositionText (the commit reconciles)", () => {
    expect(imeReconstruct("아 ", "deleteCompositionText", "")).toBeNull();
  });

  it("erases the previous unit on delete, leaving an empty unit", () => {
    expect(imeReconstruct("녕", "deleteContentBackward", "")).toEqual({
      send: "\x7f",
      unit: "",
    });
  });

  it("always erases at least one code point on delete", () => {
    expect(imeReconstruct("", "deleteContentBackward", "")).toEqual({
      send: "\x7f",
      unit: "",
    });
  });

  it("ignores empty insert data and unknown input types", () => {
    expect(imeReconstruct("a", "insertText", "")).toBeNull();
    expect(imeReconstruct("a", "insertFromPaste", "p")).toBeNull();
    expect(imeReconstruct("a", "historyUndo", "")).toBeNull();
  });

  // The end-to-end invariant: replaying the WKWebView event trace for a word
  // must reconstruct exactly that word on the PTY line, with no leaked jamo.
  it("reconstructs '안녕' from the WKWebView event trace", () => {
    const trace: Array<[string, string]> = [
      ["insertText", "ㅇ"],
      ["insertReplacementText", "아"],
      ["insertReplacementText", "안"],
      ["insertReplacementText", "안"],
      ["insertText", "ㄴ"],
      ["insertReplacementText", "녀"],
      ["insertReplacementText", "녕"],
      ["insertReplacementText", "녕"],
    ];
    let unit = "";
    let line = "";
    for (const [type, data] of trace) {
      const step = imeReconstruct(unit, type, data);
      if (!step) continue;
      line = applyToLine(line, step.send);
      unit = step.unit;
    }
    expect(line).toBe("안녕");
  });

  // The composition-event model (current macOS WKWebView): each step carries the
  // full preedit, a deleteCompositionText clears it, insertFromComposition
  // commits. Replaying the real '아 ' trace must yield exactly "아 ".
  it("reconstructs '아 ' from the composition-event trace", () => {
    const trace: Array<[string, string]> = [
      ["insertCompositionText", "ㅇ"],
      ["insertCompositionText", "아"],
      ["insertCompositionText", "아 "],
      ["deleteCompositionText", ""],
      ["insertFromComposition", "아 "],
    ];
    let unit = "";
    let line = "";
    for (const [type, data] of trace) {
      const step = imeReconstruct(unit, type, data);
      if (!step) continue;
      line = applyToLine(line, step.send);
      unit = step.unit;
    }
    expect(line).toBe("아 ");
  });
});
