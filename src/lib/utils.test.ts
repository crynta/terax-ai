import { describe, expect, it } from "vitest";
import { isMarkdownPath } from "./utils";

describe("isMarkdownPath", () => {
  it("matches markdown extensions case-insensitively", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("notes.markdown")).toBe(true);
    expect(isMarkdownPath("doc.mdx")).toBe(true);
    expect(isMarkdownPath("a/b/c.Md")).toBe(true);
  });

  it("only matches the extension at the end of the path", () => {
    expect(isMarkdownPath("file.md.txt")).toBe(false);
    expect(isMarkdownPath("x.mdxx")).toBe(false);
  });

  it("rejects non-markdown or extensionless paths", () => {
    expect(isMarkdownPath("file.txt")).toBe(false);
    expect(isMarkdownPath("mdfile")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
  });
});
