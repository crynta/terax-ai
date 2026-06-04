import { describe, expect, it } from "vitest";
import { buildAgentStatusSurface } from "./statusSurface";
import type {
  AgentNotification,
  AgentSession,
  LocalAgentState,
  PiAgentSessionState,
} from "./types";

const terminalSession: AgentSession = {
  agent: "Claude Code",
  attentionSince: 200,
  lastActivityAt: 200,
  leafId: 7,
  startedAt: 100,
  status: "waiting",
  tabId: 3,
};

function notification(
  partial: Partial<AgentNotification> &
    Pick<AgentNotification, "id" | "kind" | "source">,
): AgentNotification {
  return {
    ...partial,
    agent: partial.agent ?? "Pi",
    at: partial.at ?? 0,
    leafId: partial.leafId ?? 0,
    read: partial.read ?? false,
    tabId: partial.tabId ?? 0,
  };
}

describe("buildAgentStatusSurface", () => {
  it("sorts live agents by attention, working, then recent completed activity", () => {
    const localAgent: LocalAgentState = {
      agent: "Terax",
      attentionSince: null,
      lastActivityAt: 300,
      startedAt: 250,
      status: "working",
    };
    const piSession: PiAgentSessionState = {
      body: "Update the sidebar",
      lastActivityAt: 500,
      sessionId: "pi-1",
      status: "working",
      title: "Sidebar plan",
    };

    const surface = buildAgentStatusSurface({
      localAgent,
      notifications: [
        notification({
          at: 800,
          body: "Explain auth",
          id: "n-finished",
          kind: "finished",
          piSessionId: "pi-2",
          source: "pi",
          title: "Pi response ready",
        }),
      ],
      piSessions: { "pi-1": piSession },
      sessions: { 7: terminalSession },
      terminalContext: {
        7: { cwd: "/Users/me/Projects/terax-pi", title: "api" },
      },
    });

    expect(
      surface.items.map((item) => [item.id, item.status, item.title]),
    ).toEqual([
      ["terminal:7", "attention", "Claude Code"],
      ["pi:pi-1", "working", "Sidebar plan"],
      ["local", "working", "Terax AI"],
      ["notification:n-finished", "finished", "Pi response ready"],
    ]);
    expect(surface.counts).toEqual({
      attention: 1,
      failed: 0,
      total: 4,
      unread: 1,
      working: 2,
    });
  });

  it("folds unread notifications into the matching live row", () => {
    const surface = buildAgentStatusSurface({
      localAgent: null,
      notifications: [
        notification({
          agent: "Claude Code",
          at: 250,
          id: "n-attention",
          kind: "attention",
          leafId: 7,
          read: false,
          source: "terminal",
          tabId: 3,
          title: "Claude Code needs your input",
        }),
        notification({
          agent: "Claude Code",
          at: 260,
          id: "n-finished",
          kind: "finished",
          leafId: 7,
          read: false,
          source: "terminal",
          tabId: 3,
          title: "Claude Code finished",
        }),
      ],
      piSessions: {},
      sessions: { 7: terminalSession },
    });

    expect(surface.items).toHaveLength(1);
    expect(surface.items[0]).toEqual(
      expect.objectContaining({
        dismissible: false,
        id: "terminal:7",
        notificationId: null,
        status: "attention",
        unread: true,
      }),
    );
    expect(surface.counts.unread).toBe(1);
  });

  it("keeps finished Pi notifications activatable by session id", () => {
    const surface = buildAgentStatusSurface({
      localAgent: null,
      notifications: [
        notification({
          at: 900,
          body: "Ready to review",
          id: "n-pi",
          kind: "finished",
          piSessionId: "pi-9",
          source: "pi",
          title: "Pi response ready",
        }),
      ],
      piSessions: {},
      sessions: {},
    });

    expect(surface.recentItems[0]).toEqual(
      expect.objectContaining({
        activate: { piSessionId: "pi-9" },
        dismissible: true,
        id: "notification:n-pi",
        notificationId: "n-pi",
        source: "pi",
        status: "finished",
        subtitle: "Ready to review",
      }),
    );
  });

  it("adds branch and worktree identity to terminal rows", () => {
    const surface = buildAgentStatusSurface({
      localAgent: null,
      notifications: [],
      piSessions: {},
      sessions: { 7: terminalSession },
      terminalContext: {
        7: {
          branch: "feat/agent-status",
          cwd: "/Users/me/Projects/terax-pi",
          project: "terax-pi",
          title: "api",
          worktree: "terax-pi-agent-status",
        },
      },
    });

    expect(surface.liveItems[0]).toEqual(
      expect.objectContaining({
        detail: "feat/agent-status · terax-pi-agent-status",
        subtitle: "terax-pi",
      }),
    );
  });

  it("caps unmatched recent rows separately from live status rows", () => {
    const surface = buildAgentStatusSurface({
      localAgent: null,
      notifications: [1, 2, 3, 4, 5].map((index) =>
        notification({
          at: index * 100,
          id: `n-${index}`,
          kind: "finished",
          piSessionId: `pi-${index}`,
          source: "pi",
          title: `Pi response ${index}`,
        }),
      ),
      piSessions: {},
      recentLimit: 3,
      sessions: { 7: terminalSession },
    });

    expect(surface.liveItems.map((item) => item.id)).toEqual(["terminal:7"]);
    expect(surface.recentItems.map((item) => item.id)).toEqual([
      "notification:n-5",
      "notification:n-4",
      "notification:n-3",
    ]);
    expect(surface.items).toHaveLength(4);
  });

  it("keeps recent rows ordered by activity instead of severity", () => {
    const surface = buildAgentStatusSurface({
      localAgent: null,
      notifications: [
        notification({
          at: 100,
          id: "old-error",
          kind: "error",
          source: "terminal",
          title: "Old failure",
        }),
        notification({
          at: 300,
          id: "new-finished",
          kind: "finished",
          source: "terminal",
          title: "New finish",
        }),
      ],
      piSessions: {},
      recentLimit: 1,
      sessions: {},
    });

    expect(surface.recentItems.map((item) => item.id)).toEqual([
      "notification:new-finished",
    ]);
  });

  it("does not treat unmatched recent updates as active needs input", () => {
    const surface = buildAgentStatusSurface({
      localAgent: null,
      notifications: [
        notification({
          at: 400,
          id: "stale-attention",
          kind: "attention",
          source: "terminal",
          title: "Stale input request",
        }),
        notification({
          at: 300,
          id: "old-error",
          kind: "error",
          source: "terminal",
          title: "Old failure",
        }),
      ],
      piSessions: {},
      sessions: {},
    });

    expect(surface.recentItems.map((item) => item.id)).toEqual([
      "notification:old-error",
    ]);
    expect(surface.counts.attention).toBe(0);
    expect(surface.counts.failed).toBe(0);
  });

  it("counts live failures separately from input requests", () => {
    const failedSession: AgentSession = {
      ...terminalSession,
      lastActivityAt: 500,
      leafId: 8,
      status: "error",
      tabId: 4,
    };
    const surface = buildAgentStatusSurface({
      localAgent: null,
      notifications: [],
      piSessions: {},
      sessions: { 7: terminalSession, 8: failedSession },
    });

    expect(surface.counts.attention).toBe(1);
    expect(surface.counts.failed).toBe(1);
  });
});
