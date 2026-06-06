import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "./agentStore";

function resetStore() {
  useAgentStore.setState({
    localAgent: null,
    notifications: [],
    piSessions: {},
    sessions: {},
  });
}

describe("agent notification store", () => {
  beforeEach(resetStore);

  it("stores Pi notifications with session activation metadata", () => {
    useAgentStore.getState().pushNotification({
      agent: "Pi",
      body: "Explain the auth flow",
      kind: "finished",
      leafId: 0,
      piSessionId: "pi-1",
      source: "pi",
      tabId: 0,
      title: "Pi response ready",
    });

    expect(useAgentStore.getState().notifications[0]).toEqual(
      expect.objectContaining({
        body: "Explain the auth flow",
        kind: "finished",
        piSessionId: "pi-1",
        read: false,
        source: "pi",
        title: "Pi response ready",
      }),
    );
  });

  it("can mark only Pi notifications read", () => {
    const store = useAgentStore.getState();
    store.pushNotification({
      agent: "Pi",
      kind: "finished",
      leafId: 0,
      piSessionId: "pi-1",
      source: "pi",
      tabId: 0,
      title: "Pi response ready",
    });
    store.pushNotification({
      agent: "Claude",
      kind: "finished",
      leafId: 7,
      source: "terminal",
      tabId: 3,
      title: "Claude finished",
    });

    useAgentStore.getState().markSourceRead("pi");

    expect(
      useAgentStore.getState().notifications.map((notification) => ({
        read: notification.read,
        source: notification.source,
      })),
    ).toEqual([
      { read: false, source: "terminal" },
      { read: true, source: "pi" },
    ]);
  });

  it("can mark only one Pi notification category read", () => {
    const store = useAgentStore.getState();
    store.pushNotification({
      agent: "Pi",
      category: "code-run",
      kind: "finished",
      leafId: 0,
      piSessionId: "code-1",
      source: "pi",
      tabId: 0,
      title: "Code run ready",
    });
    store.pushNotification({
      agent: "Pi",
      category: "artifact",
      kind: "finished",
      leafId: 0,
      piSessionId: "chat-1",
      source: "pi",
      tabId: 0,
      title: "Artifact ready",
    });

    useAgentStore.getState().markPiNotificationsRead("code-run");

    expect(
      useAgentStore.getState().notifications.map((notification) => ({
        category: notification.category,
        read: notification.read,
      })),
    ).toEqual([
      { category: "artifact", read: false },
      { category: "code-run", read: true },
    ]);
  });

  it("removes one history notification without touching live sessions", () => {
    const store = useAgentStore.getState();
    store.start(7, 3, "Claude Code");
    store.pushNotification({
      agent: "Pi",
      kind: "finished",
      leafId: 0,
      piSessionId: "pi-1",
      source: "pi",
      tabId: 0,
      title: "Pi response ready",
    });
    store.pushNotification({
      agent: "Codex",
      kind: "error",
      leafId: 8,
      source: "terminal",
      tabId: 4,
      title: "Codex failed",
    });

    const id = useAgentStore.getState().notifications[0].id;
    useAgentStore.getState().removeNotification(id);

    expect(useAgentStore.getState().sessions[7]).toMatchObject({
      agent: "Claude Code",
      status: "working",
    });
    expect(useAgentStore.getState().notifications).toHaveLength(1);
    expect(useAgentStore.getState().notifications[0].title).toBe(
      "Pi response ready",
    );
  });

  it("clears history without touching live sessions", () => {
    const store = useAgentStore.getState();
    store.start(7, 3, "Claude Code");
    store.pushNotification({
      agent: "Pi",
      kind: "finished",
      leafId: 0,
      piSessionId: "pi-1",
      source: "pi",
      tabId: 0,
      title: "Pi response ready",
    });

    useAgentStore.getState().clearNotifications();

    expect(useAgentStore.getState().notifications).toEqual([]);
    expect(useAgentStore.getState().sessions[7]).toMatchObject({
      agent: "Claude Code",
      status: "working",
    });
  });

  it("tracks Pi sessions as live agent activity", () => {
    useAgentStore.getState().setPiSession({
      body: "Plan notification surface",
      lastActivityAt: 100,
      sessionId: "pi-1",
      status: "working",
      title: "Notifications",
    });
    useAgentStore.getState().setPiSession({
      body: "Plan notification surface",
      lastActivityAt: 200,
      sessionId: "pi-1",
      status: "finished",
      title: "Notifications",
    });

    expect(useAgentStore.getState().piSessions["pi-1"]).toEqual({
      body: "Plan notification surface",
      lastActivityAt: 200,
      sessionId: "pi-1",
      status: "finished",
      title: "Notifications",
    });
  });

  it("removes Pi sessions when they are deleted or forgotten", () => {
    const store = useAgentStore.getState();
    store.setPiSession({
      lastActivityAt: 100,
      sessionId: "pi-1",
      status: "working",
      title: "Notifications",
    });

    store.removePiSession("pi-1");

    expect(useAgentStore.getState().piSessions).toEqual({});
  });
});
