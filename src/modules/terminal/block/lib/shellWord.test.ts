import { describe, expect, it } from "vitest";
import { shellWordBefore } from "./shellWord";

const posix = (line: string) => shellWordBefore(line, false);
const windows = (line: string) => shellWordBefore(line, true);

describe("shellWordBefore (posix)", () => {
  it("matches a plain argument", () => {
    expect(posix("cd src/te")).toEqual({ start: 3, text: "src/te" });
  });

  it("keeps a backslash-escaped name in one word", () => {
    expect(posix("cd My\\ Fol").text).toBe("My\\ Fol");
    expect(posix("ls My\\ Folder/ne").text).toBe("My\\ Folder/ne");
  });

  it("keeps an escaped space inside a completed path in one word", () => {
    expect(posix("cat My\\ Folder/").text).toBe("My\\ Folder/");
  });

  it("stops at an unescaped space", () => {
    expect(posix("cd My ")).toEqual({ start: 6, text: "" });
    expect(posix("git status ")).toEqual({ start: 11, text: "" });
  });

  it("treats an escaped backslash as one character", () => {
    expect(posix("cd a\\\\b").text).toBe("a\\\\b");
  });

  it("still completes the argument after a command separator", () => {
    expect(posix("echo hi; cd My\\ F")).toEqual({ start: 12, text: "My\\ F" });
  });

  it("treats quotes as ordinary separators, since it writes backslash escapes", () => {
    expect(posix("cd 'My Folder'")).toEqual({ start: 14, text: "" });
  });
});

describe("shellWordBefore (windows)", () => {
  it("matches a plain argument", () => {
    expect(windows("cd src\\te")).toEqual({ start: 3, text: "src\\te" });
  });

  it("keeps a backslash-escaped name in one word", () => {
    expect(windows("cd My\\ Folder/ne").text).toBe("My\\ Folder/ne");
  });

  it("keeps a completed quoted path together", () => {
    expect(windows("cd 'My Folder'/su").text).toBe("'My Folder'/su");
    expect(windows("cd 'My Folder'").text).toBe("'My Folder'");
  });

  it("keeps a still-open quoted path together", () => {
    expect(windows("cd 'My Fol")).toEqual({ start: 3, text: "'My Fol" });
    expect(windows("cd 'My Folder/sub").text).toBe("'My Folder/sub");
  });

  it("keeps a quoted segment after a slash together", () => {
    expect(windows("cd dir/'My Fol")).toEqual({
      start: 3,
      text: "dir/'My Fol",
    });
  });

  it("does not swallow the next argument after a complete quoted word", () => {
    expect(windows("cat 'a b' c")).toEqual({ start: 10, text: "c" });
    expect(windows('cat "a b" c')).toEqual({ start: 10, text: "c" });
    expect(windows("a 'b c' d")).toEqual({ start: 8, text: "d" });
  });

  it("stops at a command separator even inside a closed quote run", () => {
    expect(windows("echo 'a' && cat 'b c")).toEqual({
      start: 16,
      text: "'b c",
    });
    expect(windows("ls 'a'|'b c")).toEqual({ start: 7, text: "'b c" });
  });

  it("stops at an unescaped space", () => {
    expect(windows("cd My ")).toEqual({ start: 6, text: "" });
  });
});
