// Pure core for the macOS IME reconstruction (see attachImeInput). Maps the
// last on-screen unit + an InputEvent to the PTY bytes and the new unit.
// Handles both WKWebView input models: the composition one
// (insertCompositionText/insertFromComposition) and the plain replacement one
// (insertText/insertReplacementText).
export type ImeStep = { send: string; unit: string };

const DEL = "\x7f";
const cpLen = (s: string): number => [...s].length;

export function imeReconstruct(
  unit: string,
  inputType: string,
  data: string,
): ImeStep | null {
  // Replacement-style events carry the full current composing text, which
  // supersedes the previous on-screen unit (erase it, write the new one).
  if (
    inputType === "insertReplacementText" ||
    inputType === "insertCompositionText"
  ) {
    if (!data || data === unit) return null;
    return { send: DEL.repeat(cpLen(unit)) + data, unit: data };
  }
  // Commit: the composed text is finalized. Reconcile against what's on screen
  // (usually already equal), then clear the unit for the next syllable.
  if (inputType === "insertFromComposition") {
    if (data === unit) return { send: "", unit: "" };
    return { send: DEL.repeat(cpLen(unit)) + (data ?? ""), unit: "" };
  }
  // Preedit cleared just before a commit — ignore; insertFromComposition
  // reconciles. Handling it would flicker on every commit.
  if (inputType === "deleteCompositionText") return null;
  // A fresh standalone unit (non-composition input, e.g. other webviews).
  if (inputType === "insertText") {
    if (!data) return null;
    return { send: data, unit: data };
  }
  // Backspace and other deletions erase the current unit.
  if (inputType.startsWith("delete")) {
    return { send: DEL.repeat(Math.max(1, cpLen(unit))), unit: "" };
  }
  return null;
}
