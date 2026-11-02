import { describe, expect, it } from "vitest";
import {
  applyRenderedView,
  type EditorTab,
  type MarkdownTab,
  type PreviewTab,
} from "./useTabs";

const editor = (path: string, extra: Partial<EditorTab> = {}): EditorTab => ({
  id: 1,
  kind: "editor",
  spaceId: "s",
  title: path.split("/").pop() ?? path,
  path,
  dirty: false,
  preview: true,
  ...extra,
});

const rendered = (path: string): MarkdownTab => ({
  id: 1,
  kind: "markdown",
  spaceId: "s",
  title: path.split("/").pop() ?? path,
  path,
});

describe("applyRenderedView", () => {
  it.each(["/w/README.md", "/w/index.html", "/w/old.htm"])(
    "switches a clean editor tab for %s to the rendered view",
    (path) => {
      const next = applyRenderedView(editor(path), "rendered");
      expect(next.kind).toBe("markdown");
      expect((next as MarkdownTab).path).toBe(path);
      expect(next.id).toBe(1);
    },
  );

  it("keeps a dirty editor tab raw so unsaved edits are never hidden", () => {
    const tab = editor("/w/index.html", { dirty: true });
    expect(applyRenderedView(tab, "rendered")).toBe(tab);
  });

  it("returns a rendered tab to a pinned, clean editor", () => {
    const next = applyRenderedView(rendered("/w/index.html"), "raw");
    expect(next).toMatchObject({
      kind: "editor",
      path: "/w/index.html",
      dirty: false,
      preview: false,
      overrideLanguage: null,
    });
  });

  it("carries a language override across the round trip", () => {
    const tab = editor("/w/index.html", { overrideLanguage: "xml" });
    const back = applyRenderedView(applyRenderedView(tab, "rendered"), "raw");
    expect((back as EditorTab).overrideLanguage).toBe("xml");
  });

  it("leaves files without a rendered view alone", () => {
    const tab = editor("/w/main.ts");
    expect(applyRenderedView(tab, "rendered")).toBe(tab);
  });

  it("leaves tabs without a path alone", () => {
    const tab: PreviewTab = {
      id: 1,
      kind: "preview",
      spaceId: "s",
      title: "x",
      url: "http://localhost:3000",
    };
    expect(applyRenderedView(tab, "rendered")).toBe(tab);
  });

  it("is a no-op when the tab is already in the requested view", () => {
    const md = rendered("/w/index.html");
    expect(applyRenderedView(md, "rendered")).toBe(md);
    const ed = editor("/w/index.html");
    expect(applyRenderedView(ed, "raw")).toBe(ed);
  });
});
