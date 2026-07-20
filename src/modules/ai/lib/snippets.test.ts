import { describe, expect, it } from "vitest";
import {
  expandSnippetTokens,
  isValidHandle,
  normalizeHandle,
  type Snippet,
} from "./snippets";

function snippet(
  over: Partial<Snippet> & Pick<Snippet, "id" | "handle">,
): Snippet {
  return { name: "", description: "", content: "", ...over };
}

describe("normalizeHandle", () => {
  it("lowercases and hyphenates whitespace", () => {
    expect(normalizeHandle("Hello World")).toBe("hello-world");
  });

  it("drops characters outside [a-z0-9-]", () => {
    expect(normalizeHandle("My Cool Snippet!!")).toBe("my-cool-snippet");
  });

  it("collapses repeated hyphens and trims leading/trailing ones", () => {
    expect(normalizeHandle("--a--b--")).toBe("a-b");
  });
});

describe("isValidHandle", () => {
  it("accepts lowercase alphanumeric handles", () => {
    expect(isValidHandle("foo-bar")).toBe(true);
    expect(isValidHandle("a")).toBe(true);
  });

  it("rejects empty, leading-hyphen, and uppercase handles", () => {
    expect(isValidHandle("")).toBe(false);
    expect(isValidHandle("-x")).toBe(false);
    expect(isValidHandle("Foo")).toBe(false);
  });
});

describe("expandSnippetTokens", () => {
  const snippets = [
    snippet({ id: "1", handle: "greet", content: "Hello" }),
    snippet({ id: "2", handle: "bye", content: "Goodbye" }),
  ];

  it("replaces a known token and emits its block", () => {
    const { body, blocks } = expandSnippetTokens("#greet now", snippets);
    expect(body).toBe("now");
    expect(blocks).toEqual(['<snippet name="greet">\nHello\n</snippet>']);
  });

  it("matches handles case-insensitively", () => {
    const { body, blocks } = expandSnippetTokens("do #GREET please", snippets);
    expect(body).not.toContain("#GREET");
    expect(blocks).toEqual(['<snippet name="greet">\nHello\n</snippet>']);
  });

  it("expands multiple distinct tokens in order", () => {
    const { blocks } = expandSnippetTokens("#greet and #bye", snippets);
    expect(blocks).toEqual([
      '<snippet name="greet">\nHello\n</snippet>',
      '<snippet name="bye">\nGoodbye\n</snippet>',
    ]);
  });

  it("emits a repeated snippet only once", () => {
    const { blocks } = expandSnippetTokens("#greet #greet", snippets);
    expect(blocks).toHaveLength(1);
  });

  it("leaves unknown tokens untouched", () => {
    const { body, blocks } = expandSnippetTokens("say #missing ok", snippets);
    expect(body).toBe("say #missing ok");
    expect(blocks).toEqual([]);
  });

  it("does not expand a token glued to a preceding word", () => {
    const { body, blocks } = expandSnippetTokens("email#greet", snippets);
    expect(body).toBe("email#greet");
    expect(blocks).toEqual([]);
  });
});
