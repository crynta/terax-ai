// Pure core for the macOS WKWebView IME reconstruction (see attachImeInput in
// rendererPool). Given the last committed input unit and a DOM InputEvent
// (inputType + data), it returns the bytes to write to the PTY and the new
// unit. A new unit is appended; a replacement erases the previous unit (one
// DEL per code point) and resends; a delete erases the previous unit.
export type ImeStep = { send: string; unit: string };

const DEL = "\x7f";
const cpLen = (s: string): number => [...s].length;

export function imeReconstruct(
  unit: string,
  inputType: string,
  data: string,
): ImeStep | null {
  if (inputType === "insertReplacementText") {
    if (!data) return null;
    return { send: DEL.repeat(cpLen(unit)) + data, unit: data };
  }
  if (inputType === "insertText" || inputType === "insertCompositionText") {
    if (!data) return null;
    return { send: data, unit: data };
  }
  if (inputType.startsWith("delete")) {
    return { send: DEL.repeat(Math.max(1, cpLen(unit))), unit: "" };
  }
  return null;
}
