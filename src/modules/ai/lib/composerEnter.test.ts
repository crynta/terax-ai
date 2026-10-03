import { describe, expect, it } from "vitest";
import { shouldSubmitComposerEnter } from "./composerEnter";

describe("shouldSubmitComposerEnter", () => {
  it("submits plain Enter", () => {
    expect(shouldSubmitComposerEnter({ key: "Enter", shiftKey: false })).toBe(
      true,
    );
  });

  it("keeps Shift+Enter as a newline", () => {
    expect(shouldSubmitComposerEnter({ key: "Enter", shiftKey: true })).toBe(
      false,
    );
  });

  it("ignores Enter during IME composition", () => {
    expect(
      shouldSubmitComposerEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });

  it("ignores Chromium Process Enter (keyCode 229)", () => {
    expect(
      shouldSubmitComposerEnter({
        key: "Enter",
        shiftKey: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it("ignores Enter while a paste is settling (Windows multiline)", () => {
    expect(
      shouldSubmitComposerEnter({
        key: "Enter",
        shiftKey: false,
        isPasting: true,
      }),
    ).toBe(false);
  });

  it("ignores Enter while Ctrl/Meta/Alt is held (Ctrl+V paste synth)", () => {
    expect(
      shouldSubmitComposerEnter({
        key: "Enter",
        shiftKey: false,
        ctrlKey: true,
      }),
    ).toBe(false);
    expect(
      shouldSubmitComposerEnter({
        key: "Enter",
        shiftKey: false,
        metaKey: true,
      }),
    ).toBe(false);
  });

  it("ignores non-Enter keys", () => {
    expect(shouldSubmitComposerEnter({ key: "a", shiftKey: false })).toBe(
      false,
    );
  });
});
