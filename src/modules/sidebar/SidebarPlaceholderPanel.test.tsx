import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarPlaceholderPanel } from "./SidebarPlaceholderPanel";

describe("SidebarPlaceholderPanel", () => {
  it("renders a named placeholder panel", () => {
    const html = renderToStaticMarkup(
      <SidebarPlaceholderPanel
        description="Conversation workspace is coming soon."
        title="Chat"
      />,
    );

    expect(html).toContain("Chat");
    expect(html).toContain("Conversation workspace is coming soon.");
    expect(html).toContain("Coming soon");
    expect(html).toContain(
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/80",
    );
  });
});
