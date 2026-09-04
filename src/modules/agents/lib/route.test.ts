import { beforeEach, describe, expect, it, vi } from "vitest";

const preferences = vi.hoisted(() => ({
  agentNotifications: true,
  agentNotificationSound: true,
}));
const notifications = vi.hoisted(() => ({
  pushNotification: vi.fn(),
  osNotify: vi.fn(async () => "requested" as const),
  playSound: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => preferences },
}));
vi.mock("../components/AgentToast", () => ({
  showAgentToast: notifications.showToast,
}));
vi.mock("../store/agentStore", () => ({
  useAgentStore: {
    getState: () => ({ pushNotification: notifications.pushNotification }),
  },
}));
vi.mock("./notify", () => ({ osNotify: notifications.osNotify }));
vi.mock("./sound", () => ({
  playAgentNotificationSound: notifications.playSound,
}));

beforeEach(() => {
  vi.clearAllMocks();
  preferences.agentNotifications = true;
  preferences.agentNotificationSound = true;
});

describe("routeAgentNotification sound preference", () => {
  it("plays sound after requesting a native notification", async () => {
    const { routeAgentNotification } = await import("./route");

    routeAgentNotification({
      source: "terminal",
      agent: "codex",
      kind: "attention",
      title: "Codex needs your input",
      focused: false,
      visible: false,
      allowToast: true,
      tabId: 101,
      leafId: 201,
      onActivate: vi.fn(),
    });
    await vi.waitFor(() => expect(notifications.osNotify).toHaveBeenCalledOnce());

    expect(notifications.playSound).toHaveBeenCalledOnce();
  });

  it("keeps native notifications silent when sound is disabled", async () => {
    preferences.agentNotificationSound = false;
    const { routeAgentNotification } = await import("./route");

    routeAgentNotification({
      source: "terminal",
      agent: "codex",
      kind: "attention",
      title: "Codex needs your input",
      focused: false,
      visible: false,
      allowToast: true,
      tabId: 102,
      leafId: 202,
      onActivate: vi.fn(),
    });
    await vi.waitFor(() => expect(notifications.osNotify).toHaveBeenCalledOnce());

    expect(notifications.pushNotification).toHaveBeenCalledOnce();
    expect(notifications.playSound).not.toHaveBeenCalled();
  });

  it("keeps in-app toasts silent when sound is disabled", async () => {
    preferences.agentNotificationSound = false;
    const { routeAgentNotification } = await import("./route");

    routeAgentNotification({
      source: "terminal",
      agent: "gemini",
      kind: "attention",
      title: "Gemini needs your input",
      focused: true,
      visible: false,
      allowToast: true,
      tabId: 103,
      leafId: 203,
      onActivate: vi.fn(),
    });

    expect(notifications.showToast).toHaveBeenCalledOnce();
    expect(notifications.playSound).not.toHaveBeenCalled();
  });
});
