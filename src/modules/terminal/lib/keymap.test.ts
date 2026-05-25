import { describe, expect, it } from "vitest";

import { terminalWordNavigationSequence } from "./keymap";

describe("terminalWordNavigationSequence", () => {
  it("maps Option+Left to readline word-left", () => {
    expect(
      terminalWordNavigationSequence({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        key: "ArrowLeft",
        code: "ArrowLeft",
      }),
    ).toBe("\x1bb");
  });

  it("maps Option+Right to readline word-right", () => {
    expect(
      terminalWordNavigationSequence({
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        key: "ArrowRight",
        code: "ArrowRight",
      }),
    ).toBe("\x1bf");
  });

  it("does not remap plain arrows", () => {
    expect(
      terminalWordNavigationSequence({
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        key: "ArrowLeft",
        code: "ArrowLeft",
      }),
    ).toBeNull();
  });
});
