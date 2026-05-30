import { describe, expect, it } from "vitest";

import {
  defaultFileViewForPath,
  isMarkdownPreviewPath,
  isNotebookPath,
} from "./fileKinds";

describe("file view routing", () => {
  it("detects markdown files that can be previewed", () => {
    expect(isMarkdownPreviewPath("README.md")).toBe(true);
    expect(isMarkdownPreviewPath("docs/guide.markdown")).toBe(true);
    expect(isMarkdownPreviewPath("C:\\work\\page.MDX")).toBe(true);
    expect(isMarkdownPreviewPath("README.md.bak")).toBe(false);
  });

  it("detects notebooks case-insensitively", () => {
    expect(isNotebookPath("analysis.ipynb")).toBe(true);
    expect(isNotebookPath("C:\\work\\DATA.IPYNB")).toBe(true);
    expect(isNotebookPath("analysis.ipynb.txt")).toBe(false);
  });

  it("routes notebooks to the built-in notebook view and leaves markdown editable", () => {
    expect(defaultFileViewForPath("notes.md")).toBe("editor");
    expect(defaultFileViewForPath("notebook.ipynb")).toBe("notebook");
    expect(defaultFileViewForPath("src/app.tsx")).toBe("editor");
  });
});
