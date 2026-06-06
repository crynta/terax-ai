import { describe, expect, it } from "vitest";
import type {
  AgentNotification,
  PiAgentSessionState,
} from "@/modules/agents/lib/types";
import {
  buildInboxRows,
  countInboxUnread,
  type InboxArtifactRow,
} from "@/modules/inbox/lib/model";

const piSession = (sessionId: string, title: string): PiAgentSessionState => ({
  lastActivityAt: 100,
  sessionId,
  status: "finished",
  title,
});

describe("Inbox model", () => {
  it("builds scoped rows from Pi notifications and recent artifacts", () => {
    const notifications: AgentNotification[] = [
      {
        agent: "Pi",
        at: 200,
        category: "code-run",
        id: "n1",
        kind: "finished",
        leafId: 0,
        piSessionId: "code-1",
        read: false,
        source: "pi",
        tabId: 0,
        title: "Pi response ready",
      },
    ];
    const artifacts: InboxArtifactRow[] = [
      {
        at: 300,
        conversationId: "chat-1",
        id: "artifact:chat-1:hero",
        read: false,
        slug: "hero",
        title: "Hero mockup",
      },
    ];

    const rows = buildInboxRows({
      artifacts,
      notifications,
      piSessions: {
        "chat-1": piSession("chat-1", "Landing page"),
        "code-1": piSession("code-1", "Code work"),
      },
    });

    expect(rows.map((row) => [row.scope, row.title, row.sessionTitle])).toEqual(
      [
        ["artifacts", "Hero mockup", "Landing page"],
        ["runs", "Pi response ready", "Code work"],
      ],
    );
  });

  it("counts unread Code, Chat, and Inbox scopes separately", () => {
    const counts = countInboxUnread({
      artifacts: [
        {
          at: 300,
          conversationId: "chat-1",
          id: "artifact:chat-1:hero",
          read: false,
          slug: "hero",
          title: "Hero mockup",
        },
      ],
      notifications: [
        {
          agent: "Pi",
          at: 200,
          category: "code-run",
          id: "n1",
          kind: "finished",
          leafId: 0,
          read: false,
          source: "pi",
          tabId: 0,
          title: "Code run ready",
        },
        {
          agent: "Pi",
          at: 100,
          category: "chat-response",
          id: "n2",
          kind: "finished",
          leafId: 0,
          read: true,
          source: "pi",
          tabId: 0,
          title: "Chat ready",
        },
      ],
    });

    expect(counts).toEqual({ chat: 1, code: 1, inbox: 2 });
  });
});
