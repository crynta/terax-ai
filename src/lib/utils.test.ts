import { describe, expect, it } from "vitest";
import { isHtmlPath, isMarkdownPath, isRenderablePath } from "./utils";

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

describe("isHtmlPath", () => {
  it("matches html extensions case-insensitively", () => {
    expect(isHtmlPath("index.html")).toBe(true);
    expect(isHtmlPath("legacy.htm")).toBe(true);
    expect(isHtmlPath("page.xhtml")).toBe(true);
    expect(isHtmlPath("a/b/INDEX.HTML")).toBe(true);
  });

  it("rejects templates and look-alikes", () => {
    expect(isHtmlPath("index.html.bak")).toBe(false);
    expect(isHtmlPath("view.cshtml")).toBe(false);
    expect(isHtmlPath("page.html5")).toBe(false);
    expect(isHtmlPath("html")).toBe(false);
  });
});

describe("isRenderablePath", () => {
  it("accepts markdown and html, nothing else", () => {
    expect(isRenderablePath("README.md")).toBe(true);
    expect(isRenderablePath("index.html")).toBe(true);
    expect(isRenderablePath("main.ts")).toBe(false);
  });
});
