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

  it("treats insertCompositionText like insertText", () => {
    expect(imeReconstruct("", "insertCompositionText", "x")).toEqual({
      send: "x",
      unit: "x",
    });
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
});
