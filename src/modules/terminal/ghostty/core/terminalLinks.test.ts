import { expect, it } from "vitest";
import { detectTerminalLinks } from "./terminalLinks";

it("finds ordinary URLs without swallowing prose punctuation", () => {
  expect(
    detectTerminalLinks(
      "See (https://example.com/a_(b)). mailto:me@example.com",
    ).map((link) => link.uri),
  ).toEqual(["https://example.com/a_(b)", "mailto:me@example.com"]);
});
it("ignores executable protocols and incomplete links", () => {
  expect(
    detectTerminalLinks("javascript:alert(1) data:text/html,x https://"),
  ).toEqual([]);
});
it("trims long mixed wrapper suffixes while preserving balanced URL delimiters", () => {
  const uri = "https://example.com/a_(b)[c]{d}";
  const [link] = detectTerminalLinks(`${uri}${")]}".repeat(10_000)}`);
  expect(link).toEqual({ start: 0, end: uri.length, uri });
  expect(detectTerminalLinks("https://[::1]/a_(b)")[0].uri).toBe(
    "https://[::1]/a_(b)",
  );
});
it("finds file paths with optional line and column suffixes", () => {
  const text =
    "Read(src/foo/bar.ts:12:3) ./a.ts ../b/c.md ~/notes/x.md /Users/me/app and done.";
  expect(detectTerminalLinks(text).map((link) => link.uri)).toEqual([
    "src/foo/bar.ts:12:3",
    "./a.ts",
    "../b/c.md",
    "~/notes/x.md",
    "/Users/me/app",
  ]);
  const [link] = detectTerminalLinks("see src/a.ts.");
  expect(link).toEqual({ start: 4, end: 12, uri: "src/a.ts" });
});
it("leaves prose, dates, and URL paths alone", () => {
  expect(detectTerminalLinks("and/or 2026/10/27 km/s 1.5/2.0 / ./ ~/")).toEqual(
    [],
  );
  expect(
    detectTerminalLinks("https://example.com/a/b.ts").map((link) => link.uri),
  ).toEqual(["https://example.com/a/b.ts"]);
});
it("preserves Unicode and query parameters with correct text offsets", () => {
  const text = "日本 https://example.com/日本?q=one&x=2 end";
  const [link] = detectTerminalLinks(text);
  expect(text.slice(link.start, link.end)).toBe(
    "https://example.com/日本?q=one&x=2",
  );
});
