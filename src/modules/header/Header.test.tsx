import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Header, type SearchInlineHandle } from ".";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "",
}));

function noop() {}

describe("Header", () => {
  it("labels sidebar-related icon buttons for assistive tech", () => {
    const html = renderToStaticMarkup(
      <Header
        activeId={0}
        agentTerminalContext={{}}
        canSplit
        onActivateAgent={noop}
        onActivateLocalAgent={noop}
        onActivatePiSession={noop}
        onClose={noop}
        onNew={noop}
        onNewEditor={noop}
        onNewArtifacts={noop}
        onNewGitGraph={noop}
        onNewPreview={noop}
        onNewPrivate={noop}
        onNewWorkflow={noop}
        onOpenSettings={noop}
        onPin={noop}
        onRename={noop}
        onSelect={noop}
        onSplit={noop}
        onToggleSecondarySidebar={noop}
        onToggleSidebar={noop}
        searchRef={createRef<SearchInlineHandle>()}
        searchTarget={null}
        tabs={[]}
      />,
    );

    expect(html).toContain('aria-label="Toggle primary sidebar"');
    expect(html).toContain('aria-label="Split terminal"');
    expect(html).toContain('aria-label="Settings"');
  });
});
