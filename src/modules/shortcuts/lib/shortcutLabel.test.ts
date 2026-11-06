import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyBinding } from "../shortcuts";

const prefsMock = vi.hoisted(() => ({
  shortcuts: {} as Record<string, KeyBinding[]>,
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: () => ({ shortcuts: prefsMock.shortcuts }),
  },
}));

import { labelToHint, shortcutLabel } from "./shortcutLabel";

beforeEach(() => {
  prefsMock.shortcuts = {};
});

describe("shortcutLabel", () => {
  it("formats the default binding when there is no user override", () => {
    // Windows and Linux (the test environment): palette on Ctrl+Shift+P, Go to file on Ctrl+Shift+O.
    expect(shortcutLabel("commandPalette.open")).toBe("Ctrl Shift P");
    expect(shortcutLabel("commandPalette.files")).toBe("Ctrl Shift O");
  });

  it("prefers a user override over the default binding", () => {
    prefsMock.shortcuts = {
      "commandPalette.open": [{ ctrl: true, shift: true, key: "k" }],
    };
    expect(shortcutLabel("commandPalette.open")).toBe("Ctrl Shift K");
  });
});

describe("labelToHint", () => {
  it("spells the binding that fires, inline", () => {
    const hint = (id: Parameters<typeof shortcutLabel>[0]) =>
      labelToHint(shortcutLabel(id));
    expect(hint("tab.new")).toBe("Ctrl+Shift+T");
    expect(hint("tab.newPreview")).toBe("Ctrl+Shift+`");
    expect(hint("terminal.toggleInput")).toBe("Ctrl+Shift+Y");
    expect(hint("tab.selectByIndex")).toBe("Ctrl+Shift+1");
  });

  it("follows a user override", () => {
    prefsMock.shortcuts = {
      "tab.new": [{ ctrl: true, alt: true, key: "PageDown" }],
    };
    expect(labelToHint(shortcutLabel("tab.new"))).toBe("Ctrl+Alt+PageDown");
  });
});
