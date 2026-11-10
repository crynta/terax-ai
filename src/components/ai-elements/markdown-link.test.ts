import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { classifyLinkTarget, routeLink, wantsCopy } = await import(
  "./markdown-link"
);

describe("classifyLinkTarget", () => {
  it("treats web and mail links as external", () => {
    for (const url of [
      "https://cursor.com/changelog/2-0",
      "http://localhost:3000/a?b=1",
      "mailto:a@b.co",
    ]) {
      expect(classifyLinkTarget(url)).toBe("external");
    }
  });

  it("recognises local files: file://, absolute, home, relative and path:line", () => {
    for (const path of [
      "file:///Users/me/repo/a.ts",
      "/Users/me/repo/src/a.ts",
      "~/notes/todo.md",
      "./src/a.ts",
      "../b/c.rs",
      "src/modules/agents/reader/reader.css",
      "src/a.ts:12",
      "src/a.ts:12:3",
      "README.md:4",
    ]) {
      expect(classifyLinkTarget(path)).toBe("file");
    }
  });

  it("leaves anchors, bare words, sentences and other schemes alone", () => {
    for (const text of [
      "",
      "#section",
      "Claude",
      "README.md",
      "and/or",
      "two words.md",
      "ftp://host/file",
      "javascript:alert(1)",
    ]) {
      expect(classifyLinkTarget(text)).toBe("none");
    }
  });
});

describe("routeLink", () => {
  beforeEach(() => openUrl.mockClear());

  it("opens web links in the browser without any confirmation", () => {
    expect(routeLink("https://example.com/x", {})).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("sends files to the surface's opener, and ignores them where there is none", () => {
    const openFile = vi.fn();
    expect(routeLink("src/a.ts:12", { openFile })).toBe(true);
    expect(openFile).toHaveBeenCalledWith("src/a.ts:12");
    expect(routeLink("src/a.ts:12", {})).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("does nothing for non-links", () => {
    const openFile = vi.fn();
    expect(routeLink("#top", { openFile })).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
  });
});

describe("wantsCopy", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false };
  it("copies on middle click or Cmd+Shift+click, opens otherwise", () => {
    expect(wantsCopy({ ...click, button: 1 })).toBe(true);
    expect(wantsCopy({ ...click, metaKey: true, shiftKey: true })).toBe(true);
    expect(wantsCopy({ ...click, metaKey: true })).toBe(false);
    expect(wantsCopy(click)).toBe(false);
  });
});
