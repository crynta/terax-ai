import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarLayoutShell } from "./SidebarLayoutShell";

describe("SidebarLayoutShell", () => {
  it("clips panel content so each sidebar view owns its scroll region", () => {
    const html = renderToStaticMarkup(
      <SidebarLayoutShell
        primary={{
          activeView: "explorer",
          defaultSize: 260,
          items: [{ id: "explorer", label: "Files" }],
          panelRef: { current: null },
          visible: true,
          onResize: () => {},
          onSelectView: () => {},
          renderContent: () => <aside aria-label="Files">Primary</aside>,
        }}
        secondary={{
          activeView: "code",
          defaultSize: 260,
          items: [{ id: "code", label: "Code" }],
          panelRef: { current: null },
          visible: true,
          onResize: () => {},
          onSelectView: () => {},
          renderContent: () => <aside aria-label="Code">Secondary</aside>,
        }}
        sidebarPosition="left"
        workspace={<section>Workspace</section>}
      />,
    );

    expect(html).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card",
    );
    expect(html).toContain('class="min-h-0 min-w-0 flex-1 overflow-hidden"');
  });

  it("orders primary, workspace, and secondary according to sidebar position", () => {
    const html = renderToStaticMarkup(
      <SidebarLayoutShell
        primary={{
          activeView: "explorer",
          badges: { "source-control": 2 },
          defaultSize: 260,
          items: [
            { id: "explorer", label: "Files" },
            { id: "source-control", label: "Git" },
          ],
          panelRef: { current: null },
          visible: true,
          onResize: () => {},
          onSelectView: () => {},
          renderContent: () => <aside aria-label="Files">Primary</aside>,
        }}
        secondary={{
          activeView: "code",
          badges: { code: 1 },
          defaultSize: 260,
          items: [
            { id: "code", label: "Code" },
            { id: "chat", label: "Chat" },
            { id: "compare", label: "Compare" },
            { id: "inbox", label: "Inbox" },
          ],
          panelRef: { current: null },
          visible: true,
          onResize: () => {},
          onSelectView: () => {},
          renderContent: () => <aside aria-label="Code">Secondary</aside>,
        }}
        sidebarPosition="right"
        workspace={<section>Workspace</section>}
      />,
    );

    expect(html.indexOf("Secondary")).toBeLessThan(html.indexOf("Workspace"));
    expect(html.indexOf("Workspace")).toBeLessThan(html.indexOf("Primary"));
    expect(html).toContain('aria-label="Secondary sidebar views"');
    expect(html).toContain('aria-label="Primary sidebar views"');
  });
});
