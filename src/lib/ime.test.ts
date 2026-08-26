import { describe, expect, it } from "vitest";

import { type CompositionKeyEvent, isComposingEvent } from "./ime";

const evt = (partial: Partial<CompositionKeyEvent>): CompositionKeyEvent => ({
  keyCode: 0,
  key: "",
  ...partial,
});

describe("isComposingEvent", () => {
  it("reads the flag React forwards on nativeEvent", () => {
    expect(
      isComposingEvent(
        evt({ nativeEvent: { isComposing: true }, key: "Enter" }),
      ),
    ).toBe(true);
  });

  it("reads the flag on a plain DOM event", () => {
    expect(isComposingEvent(evt({ isComposing: true, key: "Enter" }))).toBe(
      true,
    );
  });

  // WebKit reports 229 on the Enter that confirms a candidate without ever
  // setting isComposing, which is what sends half a Korean word as a message.
  it("guards the confirming Enter that WebKit leaves unflagged", () => {
    expect(isComposingEvent(evt({ keyCode: 229, key: "Enter" }))).toBe(true);
  });

  // macOS stamps 229 on Option+key because Option is a dead-key modifier.
  it.each([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
  ])("lets Option-tagged %s through", (key) => {
    expect(isComposingEvent(evt({ keyCode: 229, key }))).toBe(false);
  });

  it("still guards navigation keys once composition is flagged", () => {
    expect(
      isComposingEvent(
        evt({
          nativeEvent: { isComposing: true },
          keyCode: 229,
          key: "ArrowUp",
        }),
      ),
    ).toBe(true);
  });

  it("ignores ordinary keystrokes", () => {
    expect(isComposingEvent(evt({ keyCode: 13, key: "Enter" }))).toBe(false);
    expect(isComposingEvent(evt({ keyCode: 27, key: "Escape" }))).toBe(false);
    expect(isComposingEvent(evt({ nativeEvent: {}, key: "a" }))).toBe(false);
  });
});
