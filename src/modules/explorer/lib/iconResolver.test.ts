import { describe, expect, it } from "vitest";
import { fileIconUrl, folderIconUrl } from "./iconResolver";

// These assertions lock the resolution chain (by-name, extension, compound
// extension, and default fallback) rather than the icon SVGs themselves, so
// they stay valid when the underlying icon set changes.
const DEFAULT = fileIconUrl("file-with-no-known-extension");

describe("fileIconUrl resolution chain", () => {
  it("returns an inline svg data url", () => {
    expect(fileIconUrl("a.ts")).toContain("data:image/svg");
  });

  it("is deterministic for the same extension", () => {
    expect(fileIconUrl("a.ts")).toBe(fileIconUrl("b.ts"));
  });

  it("resolves a known extension to something other than the default", () => {
    expect(fileIconUrl("a.ts")).not.toBe(DEFAULT);
  });

  it("distinguishes a compound extension from its base", () => {
    // .test.tsx should resolve differently from a plain .tsx.
    expect(fileIconUrl("component.test.tsx")).not.toBe(
      fileIconUrl("component.tsx"),
    );
  });

  it("resolves a by-name match (no extension) to a non-default icon", () => {
    expect(fileIconUrl("Dockerfile")).not.toBe(DEFAULT);
  });

  it("falls back to the default for an unknown extension", () => {
    expect(fileIconUrl("mystery.qzxwv")).toBe(DEFAULT);
  });
});

describe("folderIconUrl", () => {
  it("returns an inline svg data url", () => {
    expect(folderIconUrl("src", false)).toContain("data:image/svg");
  });

  it("uses distinct open and closed icons for a mapped folder", () => {
    const closed = folderIconUrl("src", false);
    const expanded = folderIconUrl("src", true);
    expect(expanded).toContain("data:image/svg");
    expect(expanded).not.toBe(closed);
  });

  it("differs from the confirmed unknown-folder fallback when mapped", () => {
    const fallback = folderIconUrl("qzxwv-dir", false);
    const fallbackExpanded = folderIconUrl("qzxwv-dir", true);
    expect(fallback).toContain("data:image/svg");
    expect(fallbackExpanded).toContain("data:image/svg");
    expect(fallbackExpanded).not.toBe(fallback);
    expect(folderIconUrl("src", false)).not.toBe(fallback);
  });
});
