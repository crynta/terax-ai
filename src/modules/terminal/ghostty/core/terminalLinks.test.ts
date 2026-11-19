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
  expect(link).toEqual({ start: 0, end: uri.length, uri, kind: "url" });
  expect(detectTerminalLinks("https://[::1]/a_(b)")[0].uri).toBe(
    "https://[::1]/a_(b)",
  );
});
it("preserves Unicode and query parameters with correct text offsets", () => {
  const text = "日本 https://example.com/日本?q=one&x=2 end";
  const [link] = detectTerminalLinks(text);
  expect(text.slice(link.start, link.end)).toBe(
    "https://example.com/日本?q=one&x=2",
  );
});

const found = (text: string) =>
  detectTerminalLinks(text).map((link) => ({
    text: text.slice(link.start, link.end),
    kind: link.kind,
    path: link.path,
    line: link.line,
    column: link.column,
  }));

it("links file paths with line and column suffixes", () => {
  expect(found("error in src/app/main.ts:12:5 here")).toEqual([
    {
      text: "src/app/main.ts:12:5",
      kind: "path",
      path: "src/app/main.ts",
      line: 12,
      column: 5,
    },
  ]);
  expect(found("./lib.rs:7 ~/notes/todo.md /etc/hosts")).toMatchObject([
    { path: "./lib.rs", line: 7 },
    { path: "~/notes/todo.md", line: undefined },
    { path: "/etc/hosts" },
  ]);
  expect(found("C:\\Users\\me\\app.log:10")).toMatchObject([
    { path: "C:\\Users\\me\\app.log", line: 10 },
  ]);
});

it("understands compiler and traceback location styles", () => {
  expect(found("Program.cs(10,5): error")).toMatchObject([
    { path: "Program.cs", line: 10, column: 5 },
  ]);
  expect(found('File "app.py", line 42, in main')).toMatchObject([
    { path: "app.py", line: 42 },
  ]);
});

it("leaves ordinary words, versions and host:port pairs alone", () => {
  expect(
    found("1.2.3 a/b localhost:3000 example.com:443 and/or -x/y.txt"),
  ).toEqual([]);
});

it("prefers a URL over a path found inside it", () => {
  const links = detectTerminalLinks(
    "see https://example.com/docs/readme.md:3 ok",
  );
  expect(links).toHaveLength(1);
  expect(links[0].kind).toBe("url");
});

it("links file URLs but not an empty one", () => {
  expect(detectTerminalLinks("file:///tmp/a.txt")[0]).toMatchObject({
    kind: "url",
    uri: "file:///tmp/a.txt",
  });
  expect(detectTerminalLinks("file:///")).toEqual([]);
});

it("bounds the work done for pathological input", () => {
  const long = `${"a/".repeat(5000)}b.ts:1 `.repeat(50);
  const started = performance.now();
  const links = detectTerminalLinks(long);
  expect(links.length).toBeLessThanOrEqual(256);
  expect(performance.now() - started).toBeLessThan(500);
});
