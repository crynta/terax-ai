import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  deriveInboxPanelState,
  InboxPanel,
} from "@/modules/inbox/components/InboxPanel";
import type { InboxRow } from "@/modules/inbox/lib/model";

const row = (overrides: Partial<InboxRow> = {}): InboxRow => ({
  action: { sessionId: "pi-1", type: "open-pi-session" },
  at: 200,
  body: "Explain the auth flow",
  id: "notification:n1",
  read: false,
  scope: "runs",
  sessionTitle: "Code work",
  title: "Pi response ready",
  ...overrides,
});

describe("InboxPanel", () => {
  it("renders scoped inbox rows", () => {
    const html = renderToStaticMarkup(
      <InboxPanel
        rows={[
          row(),
          row({
            action: {
              sessionId: "chat-1",
              slug: "hero",
              type: "open-artifact",
            },
            id: "artifact:chat-1:hero",
            scope: "artifacts",
            sessionTitle: "Landing page",
            title: "Hero mockup",
          }),
        ]}
        onClearRead={() => {}}
        onMarkRead={() => {}}
        onOpenRow={() => {}}
      />,
    );

    expect(html).toContain("Inbox");
    expect(html).toContain("Runs");
    expect(html).toContain("Artifacts");
    expect(html).toContain("Pi response ready");
    expect(html).toContain("Hero mockup");
  });

  it("renders an empty state", () => {
    const html = renderToStaticMarkup(
      <InboxPanel
        rows={[]}
        onClearRead={() => {}}
        onMarkRead={() => {}}
        onOpenRow={() => {}}
      />,
    );

    expect(html).toContain("No inbox items");
  });

  it("derives filtered rows, unread count, and read state in one pass", () => {
    const state = deriveInboxPanelState(
      [
        row({ id: "run-unread", read: false, scope: "runs" }),
        row({ id: "artifact-read", read: true, scope: "artifacts" }),
        row({ id: "chat-unread", read: false, scope: "chat" }),
      ],
      "unread",
    );

    expect(state.visibleRows.map((item) => item.id)).toEqual([
      "run-unread",
      "chat-unread",
    ]);
    expect(state.unreadCount).toBe(2);
    expect(state.hasRead).toBe(true);
  });
});
