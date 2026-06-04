import { agentProviderLabel } from "./providers";
import type {
  AgentNotification,
  AgentSession,
  AgentSource,
  AgentStatus,
  AgentSurfaceStatus,
  LocalAgentState,
  PiAgentSessionState,
} from "./types";

export type AgentStatusContext = {
  branch?: string | null;
  cwd?: string | null;
  project?: string | null;
  title?: string | null;
  worktree?: string | null;
};

export type AgentStatusActivation = {
  leafId?: number;
  piSessionId?: string;
  tabId?: number;
};

export type AgentStatusItem = {
  id: string;
  source: AgentSource;
  agent: string;
  title: string;
  subtitle?: string;
  detail?: string;
  status: AgentSurfaceStatus;
  unread: boolean;
  sortAt: number;
  activate: AgentStatusActivation;
  dismissible: boolean;
  notificationId: string | null;
};

export type AgentStatusSurface = {
  counts: {
    attention: number;
    failed: number;
    total: number;
    unread: number;
    working: number;
  };
  items: AgentStatusItem[];
  liveItems: AgentStatusItem[];
  recentItems: AgentStatusItem[];
};

export type BuildAgentStatusSurfaceArgs = {
  localAgent: LocalAgentState;
  notifications: readonly AgentNotification[];
  piSessions?: Record<string, PiAgentSessionState>;
  recentLimit?: number;
  sessions: Record<number, AgentSession>;
  terminalContext?: Record<number, AgentStatusContext>;
};

function compactPathName(path: string | null | undefined): string | undefined {
  const cleaned = path?.replace(/[\\/]+$/, "");
  if (!cleaned) return undefined;
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

function terminalSubtitle(
  session: AgentSession,
  context: AgentStatusContext | undefined,
): string {
  return (
    context?.project?.trim() ||
    context?.title?.trim() ||
    compactPathName(context?.cwd) ||
    `Terminal ${session.tabId}`
  );
}

function terminalDetail(
  context: AgentStatusContext | undefined,
): string | undefined {
  const branch = context?.branch?.trim();
  const worktree = context?.worktree?.trim();
  return (
    [branch, worktree]
      .filter((item): item is string => Boolean(item))
      .join(" · ") || undefined
  );
}

function agentStatusToSurface(status: AgentStatus): AgentSurfaceStatus {
  if (status === "waiting") return "attention";
  return status;
}

function notificationStatus(
  notification: AgentNotification,
): AgentSurfaceStatus {
  if (notification.kind === "attention") return "attention";
  return notification.kind;
}

function matchesLiveItem(
  notification: AgentNotification,
  item: AgentStatusItem,
): boolean {
  if (notification.source !== item.source) return false;
  if (item.source === "terminal") {
    return notification.leafId === item.activate.leafId;
  }
  if (item.source === "pi") {
    return Boolean(
      notification.piSessionId &&
        notification.piSessionId === item.activate.piSessionId,
    );
  }
  return item.source === "local";
}

function notificationActivation(
  notification: AgentNotification,
): AgentStatusActivation {
  if (notification.source === "pi" && notification.piSessionId) {
    return { piSessionId: notification.piSessionId };
  }
  if (notification.source === "terminal") {
    return { leafId: notification.leafId, tabId: notification.tabId };
  }
  return {};
}

function statusRank(status: AgentSurfaceStatus): number {
  switch (status) {
    case "attention":
    case "error":
      return 0;
    case "working":
      return 1;
    case "finished":
      return 2;
    case "idle":
      return 3;
  }
}

function compareItems(left: AgentStatusItem, right: AgentStatusItem): number {
  const rank = statusRank(left.status) - statusRank(right.status);
  if (rank !== 0) return rank;
  const time = right.sortAt - left.sortAt;
  if (time !== 0) return time;
  return left.id.localeCompare(right.id);
}

function compareRecentItems(
  left: AgentStatusItem,
  right: AgentStatusItem,
): number {
  const time = right.sortAt - left.sortAt;
  if (time !== 0) return time;
  const rank = statusRank(left.status) - statusRank(right.status);
  if (rank !== 0) return rank;
  return left.id.localeCompare(right.id);
}

function withUnread(
  item: AgentStatusItem,
  notifications: readonly AgentNotification[],
): AgentStatusItem {
  return {
    ...item,
    unread: notifications.some(
      (notification) =>
        !notification.read && matchesLiveItem(notification, item),
    ),
  };
}

export function buildAgentStatusSurface({
  localAgent,
  notifications,
  piSessions = {},
  recentLimit = 3,
  sessions,
  terminalContext = {},
}: BuildAgentStatusSurfaceArgs): AgentStatusSurface {
  const baseLiveItems: AgentStatusItem[] = Object.values(sessions).map(
    (session) => {
      const context = terminalContext[session.leafId];
      const label = agentProviderLabel(session.agent);
      return {
        activate: { leafId: session.leafId, tabId: session.tabId },
        agent: label,
        detail: terminalDetail(context) ?? context?.cwd ?? undefined,
        dismissible: false,
        id: `terminal:${session.leafId}`,
        notificationId: null,
        source: "terminal",
        sortAt: session.lastActivityAt,
        status: agentStatusToSurface(session.status),
        subtitle: terminalSubtitle(session, context),
        title: label,
        unread: false,
      };
    },
  );

  if (localAgent) {
    const label = agentProviderLabel(localAgent.agent);
    baseLiveItems.push({
      activate: {},
      agent: label,
      dismissible: false,
      id: "local",
      notificationId: null,
      source: "local",
      sortAt: localAgent.lastActivityAt ?? localAgent.startedAt ?? 0,
      status: agentStatusToSurface(localAgent.status),
      subtitle: "Terax agent",
      title: label,
      unread: false,
    });
  }

  for (const session of Object.values(piSessions)) {
    baseLiveItems.push({
      activate: { piSessionId: session.sessionId },
      agent: "Pi",
      detail: session.cwd ?? undefined,
      dismissible: false,
      id: `pi:${session.sessionId}`,
      notificationId: null,
      source: "pi",
      sortAt: session.lastActivityAt,
      status: session.status,
      subtitle: session.body,
      title: session.title,
      unread: false,
    });
  }

  const liveWithUnread = baseLiveItems.map((item) =>
    withUnread(item, notifications),
  );
  const recentItems = notifications
    .filter(
      (notification) =>
        notification.kind !== "attention" &&
        !liveWithUnread.some((item) => matchesLiveItem(notification, item)),
    )
    .map<AgentStatusItem>((notification) => {
      const label = agentProviderLabel(notification.agent);
      return {
        activate: notificationActivation(notification),
        agent: label,
        dismissible: true,
        id: `notification:${notification.id}`,
        notificationId: notification.id,
        source: notification.source,
        sortAt: notification.at,
        status: notificationStatus(notification),
        subtitle: notification.body,
        title:
          notification.title ??
          `${label} ${notification.kind === "attention" ? "needs input" : notification.kind}`,
        unread: !notification.read,
      };
    })
    .sort(compareRecentItems)
    .slice(0, recentLimit);

  const liveItems = liveWithUnread.sort(compareItems);
  const items = [...liveItems, ...recentItems];
  return {
    counts: {
      attention: liveItems.filter((item) => item.status === "attention").length,
      failed: liveItems.filter((item) => item.status === "error").length,
      total: items.length,
      unread: items.filter((item) => item.unread).length,
      working: liveItems.filter((item) => item.status === "working").length,
    },
    items,
    liveItems,
    recentItems,
  };
}
