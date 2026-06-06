import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "",
}));

describe("FileExplorer", () => {
  it("labels icon-only header actions", () => {
    const html = renderToStaticMarkup(
      <FileExplorer
        ref={createRef<FileExplorerHandle>()}
        rootPath="/repo"
        onOpenFile={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Search files"');
    expect(html).toContain('aria-label="New file"');
    expect(html).toContain('aria-label="New folder"');
    expect(html).toContain('aria-label="Refresh"');
  });
});
