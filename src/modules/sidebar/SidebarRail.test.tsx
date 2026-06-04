import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarRail } from "./SidebarRail";
import {
  PRIMARY_SIDEBAR_VIEW_ITEMS,
  SECONDARY_SIDEBAR_VIEW_ITEMS,
} from "./views";

describe("SidebarRail", () => {
  it("renders primary sidebar items without secondary views", () => {
    const html = renderToStaticMarkup(
      <SidebarRail
        activeView="explorer"
        badges={{ "source-control": 2 }}
        items={PRIMARY_SIDEBAR_VIEW_ITEMS}
        onSelectView={() => {}}
      />,
    );

    expect(html).toContain("Files");
    expect(html).toContain("Git");
    expect(html).toContain("2");
    expect(html).not.toContain("Code");
    expect(html).not.toContain("Chat");
    expect(html).not.toContain("Inbox");
  });

  it("renders secondary sidebar items without primary views", () => {
    const html = renderToStaticMarkup(
      <SidebarRail
        activeView="code"
        badges={{ code: 12 }}
        items={SECONDARY_SIDEBAR_VIEW_ITEMS}
        onSelectView={() => {}}
      />,
    );

    expect(html).toContain("Code");
    expect(html).toContain("Chat");
    expect(html).toContain("Inbox");
    expect(html).toContain("9+");
    expect(html).not.toContain("Files");
    expect(html).not.toContain("Git");
    expect(html).not.toContain("Pi");
  });
});
