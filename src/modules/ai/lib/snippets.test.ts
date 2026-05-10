import { describe, expect, it } from "vitest";
import {
  normalizeHandle,
  isValidHandle,
  expandSnippetTokens,
} from "@/modules/ai/lib/snippets";
import type { Snippet } from "@/modules/ai/lib/snippets";

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    expect(normalizeHandle("  Hello  ")).toBe("hello");
  });

  it("replaces spaces with dashes", () => {
    expect(normalizeHandle("my snippet")).toBe("my-snippet");
  });

  it("removes non-alphanumeric chars except dash", () => {
    expect(normalizeHandle("hello_world!")).toBe("helloworld");
  });

  it("collapses multiple dashes", () => {
    expect(normalizeHandle("a---b")).toBe("a-b");
  });

  it("strips leading/trailing dashes", () => {
    expect(normalizeHandle("-hello-")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(normalizeHandle("")).toBe("");
  });
});

describe("isValidHandle", () => {
  it("accepts valid handles", () => {
    expect(isValidHandle("my-snippet")).toBe(true);
    expect(isValidHandle("a")).toBe(true);
    expect(isValidHandle("test123")).toBe(true);
  });

  it("rejects invalid handles", () => {
    expect(isValidHandle("")).toBe(false);
    expect(isValidHandle("-dash")).toBe(false);
    expect(isValidHandle("has space")).toBe(false);
    expect(isValidHandle("UPPER")).toBe(false);
  });
});

describe("expandSnippetTokens", () => {
  const snippets: Snippet[] = [
    {
      id: "sn-1",
      handle: "fix",
      name: "Fix",
      description: "Fix bugs",
      content: "Fix the bug in $FILE",
    },
    {
      id: "sn-2",
      handle: "test",
      name: "Test",
      description: "Write tests",
      content: "Write tests for $MODULE",
    },
  ];

  it("replaces #handle tokens with empty space", () => {
    const { body } = expandSnippetTokens("please #fix this bug", snippets);
    expect(body).toBe("please  this bug");
  });

  it("returns snippet blocks for matched handles", () => {
    const { blocks } = expandSnippetTokens("#fix the issue", snippets);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("<snippet");
    expect(blocks[0]).toContain('name="fix"');
    expect(blocks[0]).toContain("Fix the bug in $FILE");
  });

  it("handles multiple snippet references", () => {
    const { blocks, body } = expandSnippetTokens(
      "#fix and #test",
      snippets,
    );
    expect(blocks).toHaveLength(2);
    expect(body).toBe("and");
  });

  it("leaves unknown handles untouched", () => {
    const { body, blocks } = expandSnippetTokens(
      "#unknown text",
      snippets,
    );
    expect(body).toBe("#unknown text");
    expect(blocks).toHaveLength(0);
  });

  it("handles text with no snippets", () => {
    const { body, blocks } = expandSnippetTokens("just regular text", snippets);
    expect(body).toBe("just regular text");
    expect(blocks).toHaveLength(0);
  });
});
