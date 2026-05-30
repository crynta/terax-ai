import { describe, expect, it } from "vitest";

import { matchBinding, SHORTCUTS } from "./shortcuts";

describe("markdown preview shortcut", () => {
  it("uses Mod+Shift+V by default", () => {
    const shortcut = SHORTCUTS.find((item) => item.id === "markdown.preview");

    expect(shortcut?.defaultBindings).toEqual([
      expect.objectContaining({ shift: true, key: "v" }),
    ]);
  });

  it("matches Ctrl+Shift+V on Windows and Linux", () => {
    const event = {
      key: "v",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    } as KeyboardEvent;

    expect(
      matchBinding(
        event,
        { ctrl: true, shift: true, key: "v" },
        "markdown.preview",
      ),
    ).toBe(true);
  });
});
