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

    expect(html).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
    );
    expect(html).toContain('aria-label="Search files"');
    expect(html).toContain('aria-label="New file"');
    expect(html).toContain('aria-label="New folder"');
    expect(html).toContain('aria-label="Refresh"');
  });

  it("bounds the empty workspace state inside the sidebar slot", () => {
    const html = renderToStaticMarkup(
      <FileExplorer
        ref={createRef<FileExplorerHandle>()}
        rootPath={null}
        onOpenFile={() => {}}
      />,
    );

    expect(html).toContain("No current directory");
    expect(html).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
    );
  });
});
