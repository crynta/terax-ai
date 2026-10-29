import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: false }));

import { SHELL_WORD_RE } from "./shellWord";

// What `CompletionContext.matchBefore` does: the leftmost match of the pattern
// that ends at the cursor is the word being completed.
function wordBefore(lineBeforeCursor: string): string {
  const atEnd = new RegExp(`(?:${SHELL_WORD_RE.source})$`);
  return lineBeforeCursor.match(atEnd)?.[0] ?? "";
}

describe("SHELL_WORD_RE", () => {
  it("matches a plain argument", () => {
    expect(wordBefore("cd src/te")).toBe("src/te");
  });

  it("keeps a backslash-escaped name in one word", () => {
    expect(wordBefore("cd My\\ Fol")).toBe("My\\ Fol");
    expect(wordBefore("ls My\\ Folder/ne")).toBe("My\\ Folder/ne");
  });

  it("keeps an escaped space inside a completed path in one word", () => {
    expect(wordBefore("cat My\\ Folder/")).toBe("My\\ Folder/");
  });

  it("stops at an unescaped space", () => {
    expect(wordBefore("cd My ")).toBe("");
    expect(wordBefore("git status ")).toBe("");
  });

  it("treats an escaped backslash as one character", () => {
    expect(wordBefore("cd a\\\\b")).toBe("a\\\\b");
  });

  it("still completes the argument after a command separator", () => {
    expect(wordBefore("echo hi; cd My\\ F")).toBe("My\\ F");
  });
});
