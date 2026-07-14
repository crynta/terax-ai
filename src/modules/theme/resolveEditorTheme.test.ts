import { describe, expect, it } from "vitest";
import { resolveEditorThemeId } from "./resolveEditorTheme";
import type { Theme } from "./types";

const custom: Theme = {
  id: "my-theme",
  name: "Mine",
  editorTheme: { dark: "dracula", light: "github-light" },
  variants: { dark: {}, light: {} },
};

describe("resolveEditorThemeId", () => {
  it("returns an explicit pref unchanged, ignoring app theme", () => {
    expect(resolveEditorThemeId("nord", "kanagawa", [], "dark")).toBe("nord");
    expect(resolveEditorThemeId("nord", "kanagawa", [], "light")).toBe("nord");
  });

  it("auto follows the builtin app theme pairing per mode", () => {
    expect(resolveEditorThemeId("auto", "kanagawa", [], "dark")).toBe("kanagawa");
    expect(resolveEditorThemeId("auto", "kanagawa", [], "light")).toBe(
      "kanagawa-lotus",
    );
  });

  it("auto falls back to the other mode when a pairing is missing", () => {
    // Dragon only declares a dark pairing.
    expect(resolveEditorThemeId("auto", "kanagawa-dragon", [], "light")).toBe(
      "kanagawa-dragon",
    );
  });

  it("auto prefers a matching custom theme over builtins", () => {
    expect(resolveEditorThemeId("auto", "my-theme", [custom], "dark")).toBe(
      "dracula",
    );
    expect(resolveEditorThemeId("auto", "my-theme", [custom], "light")).toBe(
      "github-light",
    );
  });

  it("auto with an unknown app theme uses the default theme pairing", () => {
    expect(resolveEditorThemeId("auto", "does-not-exist", [], "dark")).toBe(
      "atomone",
    );
  });

  it("auto falls back to a neutral theme when the pairing is invalid", () => {
    const bad: Theme = {
      id: "bad",
      name: "Bad",
      editorTheme: { dark: "not-a-real-theme" },
      variants: { dark: {} },
    };
    expect(resolveEditorThemeId("auto", "bad", [bad], "dark")).toBe("atomone");
    expect(resolveEditorThemeId("auto", "bad", [bad], "light")).toBe(
      "github-light",
    );
  });
});
