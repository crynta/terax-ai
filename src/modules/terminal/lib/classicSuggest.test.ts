import { describe, expect, it } from "vitest";
import {
  type ClassicSuggestKeyEvent,
  classicSuggestKeyEffect,
} from "./classicSuggest";

function key(
  keyName: string,
  over: Partial<ClassicSuggestKeyEvent> = {},
): ClassicSuggestKeyEvent {
  return {
    type: "keydown",
    key: keyName,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...over,
  };
}

describe("classicSuggestKeyEffect", () => {
  it("accepts the selected suggestion on Tab", () => {
    expect(classicSuggestKeyEffect(key("Tab"), true)).toBe("accept");
  });

  it("keeps Shift+Tab for reverse selection", () => {
    expect(classicSuggestKeyEffect(key("Tab", { shiftKey: true }), true)).toBe(
      "prev",
    );
  });

  it("keeps arrows and Escape mapped while the menu is open", () => {
    expect(classicSuggestKeyEffect(key("ArrowDown"), true)).toBe("next");
    expect(classicSuggestKeyEffect(key("ArrowUp"), true)).toBe("prev");
    expect(classicSuggestKeyEffect(key("ArrowRight"), true)).toBe("accept");
    expect(classicSuggestKeyEffect(key("End"), true)).toBe("accept");
    expect(classicSuggestKeyEffect(key("Escape"), true)).toBe("dismiss");
  });

  it("ignores keys when no menu can consume them", () => {
    expect(classicSuggestKeyEffect(key("Tab"), false)).toBe("ignore");
    expect(classicSuggestKeyEffect(key("Tab", { ctrlKey: true }), true)).toBe(
      "ignore",
    );
  });
});
