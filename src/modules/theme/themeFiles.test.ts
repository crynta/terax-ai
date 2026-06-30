import { describe, expect, it, vi } from "vitest";

// The pure helpers below pull in @tauri-apps modules at import time. Stub the
// modules so the file imports cleanly under vitest without a Tauri runtime. We
// only exercise the pure functions (isThemeFilePath, parseThemeFile,
// starterTheme); the invoke/emit/listen wrappers are intentionally not tested
// because they only forward to Tauri APIs.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: vi.fn(),
  join: vi.fn(),
}));
vi.mock("@/modules/workspace", () => ({ currentWorkspaceEnv: vi.fn() }));

import { isThemeFilePath, parseThemeFile, starterTheme } from "./themeFiles";
import { validateTheme } from "./validateTheme";

describe("isThemeFilePath", () => {
  it("matches the .terax-theme extension case-insensitively", () => {
    expect(isThemeFilePath("foo.terax-theme")).toBe(true);
    expect(isThemeFilePath("FOO.TERAX-THEME")).toBe(true);
    expect(isThemeFilePath("/abs/path/My Theme.Terax-Theme")).toBe(true);
  });

  it("rejects other extensions and bare names", () => {
    expect(isThemeFilePath("foo.json")).toBe(false);
    expect(isThemeFilePath("terax-theme")).toBe(false);
    expect(isThemeFilePath("foo.terax-theme.bak")).toBe(false);
    expect(isThemeFilePath("")).toBe(false);
  });
});

describe("parseThemeFile", () => {
  it("returns an error for malformed JSON", () => {
    const res = parseThemeFile("{ not valid json");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    expect(res.error.length).toBeGreaterThan(0);
  });

  it("returns an error for empty input", () => {
    expect(parseThemeFile("").ok).toBe(false);
  });

  it("surfaces validation errors for structurally invalid themes", () => {
    const res = parseThemeFile(JSON.stringify({ id: "ocean", name: "X" }));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected failure");
    // Missing variants is caught by validateTheme.
    expect(res.error).toBe("variants must be an object");
  });

  it("parses and validates a well-formed theme", () => {
    const json = JSON.stringify({
      id: "ocean",
      name: "Ocean",
      variants: { dark: { colors: { background: "#012" } } },
    });
    const res = parseThemeFile(json);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error);
    expect(res.theme.id).toBe("ocean");
    expect(res.theme.variants.dark?.colors?.background).toBe("#012");
  });

  it("rejects valid JSON that is not a theme object", () => {
    expect(parseThemeFile("[1,2,3]").ok).toBe(false);
    expect(parseThemeFile("42").ok).toBe(false);
    expect(parseThemeFile("null").ok).toBe(false);
  });
});

describe("starterTheme", () => {
  it("produces a theme that passes validateTheme", () => {
    const theme = starterTheme();
    const res = validateTheme(theme);
    expect(res.ok).toBe(true);
  });

  it("generates a kebab-case id with the my-theme prefix", () => {
    const theme = starterTheme();
    expect(theme.id).toMatch(/^my-theme-[0-9a-f]{8}$/);
  });

  it("produces a unique id on each call", () => {
    const ids = new Set(Array.from({ length: 20 }, () => starterTheme().id));
    expect(ids.size).toBe(20);
  });

  it("ships a dark variant with colors and a terminal palette", () => {
    const theme = starterTheme();
    expect(theme.variants.dark).toBeDefined();
    expect(theme.variants.dark?.colors?.background).toBe("#0d0d10");
    expect(theme.variants.dark?.terminal?.cursor).toBe("#e8e8ea");
  });
});
