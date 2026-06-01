import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarRail } from "./SidebarRail";

describe("SidebarRail", () => {
  it("hides Source Control when no repository is detected", () => {
    const html = renderToStaticMarkup(
      <SidebarRail
        activeView="explorer"
        onSelectView={vi.fn()}
        changedCount={4}
        hasRepo={false}
      />,
    );
    expect(html).toContain("Files");
    expect(html).not.toContain("Source Control");
  });

  it("shows Source Control and badge when repository is detected", () => {
    const html = renderToStaticMarkup(
      <SidebarRail
        activeView="explorer"
        onSelectView={vi.fn()}
        changedCount={7}
        hasRepo={true}
      />,
    );
    expect(html).toContain("Source Control");
    expect(html).toContain(">7<");
  });
});
