import { describe, expect, it } from "vitest";
import { type FocusCandidate, focusIsMovable } from "./focusGuard";

function focus(
  tagName: string,
  inside: string[],
  isContentEditable = false,
): FocusCandidate {
  return {
    tagName,
    isContentEditable,
    closest: (selector) => (inside.includes(selector) ? {} : null),
  };
}

const STACK = "[data-terminal-stack]";

describe("focusIsMovable", () => {
  it("moves focus when nothing in particular has it", () => {
    expect(focusIsMovable(null)).toBe(true);
    expect(focusIsMovable(focus("BODY", []))).toBe(true);
  });

  it("moves between views: terminal input, the code editor, tab pills", () => {
    expect(focusIsMovable(focus("TEXTAREA", [STACK, "[data-pane-leaf]"]))).toBe(
      true,
    );
    expect(focusIsMovable(focus("DIV", [STACK, ".cm-editor"], true))).toBe(
      true,
    );
    expect(focusIsMovable(focus("BUTTON", [STACK]))).toBe(true);
  });

  it("never takes focus from a text field in the workbench", () => {
    expect(focusIsMovable(focus("INPUT", [STACK]))).toBe(false);
  });

  it("keeps the composer, sidebar and dialogs focused; header controls yield", () => {
    expect(focusIsMovable(focus("TEXTAREA", []))).toBe(false);
    expect(focusIsMovable(focus("BUTTON", []))).toBe(false);
    expect(focusIsMovable(focus("DIV", ["[data-app-header]"]))).toBe(true);
    expect(focusIsMovable(focus("INPUT", ["[data-app-header]"]))).toBe(false);
  });
});
