import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InboxPanel } from "@/modules/inbox/components/InboxPanelLazy";

describe("InboxPanel lazy export", () => {
  it("renders a stable fallback through the public module export", () => {
    const html = renderToStaticMarkup(
      <InboxPanel
        rows={[]}
        onClearRead={() => {}}
        onMarkRead={() => {}}
        onOpenRow={() => {}}
      />,
    );

    expect(html).toContain("Loading inbox…");
  });
});
