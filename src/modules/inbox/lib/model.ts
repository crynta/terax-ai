import type {
  AgentNotification,
  PiAgentSessionState,
} from "@/modules/agents/lib/types";

export type InboxScope = "chat" | "artifacts" | "runs";

export type InboxArtifactRow = {
  at: number;
  body?: string;
  conversationId: string;
  id: string;
  read: boolean;
  slug: string;
  title: string;
};

export type InboxAction =
  | { type: "open-pi-session"; sessionId: string }
  | { type: "open-artifact"; sessionId: string; slug: string };

export type InboxRow = {
  action: InboxAction | null;
  at: number;
  body?: string;
  id: string;
  read: boolean;
  scope: InboxScope;
  sessionTitle?: string;
  title: string;
};

type BuildInboxRowsInput = {
  artifacts?: readonly InboxArtifactRow[];
  notifications: readonly AgentNotification[];
  piSessions?: Record<string, PiAgentSessionState>;
};

export type InboxUnreadCounts = {
  chat: number;
  code: number;
  inbox: number;
};

type CountInboxUnreadInput = {
  artifacts?: readonly InboxArtifactRow[];
  notifications: readonly AgentNotification[];
};

function notificationScope(notification: AgentNotification): InboxScope | null {
  if (notification.source !== "pi") return null;
  if (notification.category === "code-run" || !notification.category) {
    return "runs";
  }
  if (notification.category === "chat-response") return "chat";
  if (notification.category === "artifact") return "artifacts";
  return null;
}

function sessionTitle(
  piSessions: Record<string, PiAgentSessionState> | undefined,
  sessionId: string | undefined,
): string | undefined {
  if (!sessionId) return undefined;
  return piSessions?.[sessionId]?.title;
}

function notificationAction(
  notification: AgentNotification,
): InboxAction | null {
  if (!notification.piSessionId) return null;
  return { type: "open-pi-session", sessionId: notification.piSessionId };
}

export function buildInboxRows({
  artifacts = [],
  notifications,
  piSessions,
}: BuildInboxRowsInput): InboxRow[] {
  const notificationRows = notifications.flatMap<InboxRow>((notification) => {
    const scope = notificationScope(notification);
    if (!scope) return [];
    return [
      {
        action: notificationAction(notification),
        at: notification.at,
        ...(notification.body ? { body: notification.body } : {}),
        id: `notification:${notification.id}`,
        read: notification.read,
        scope,
        sessionTitle: sessionTitle(piSessions, notification.piSessionId),
        title: notification.title ?? notification.agent,
      },
    ];
  });

  const artifactRows = artifacts.map<InboxRow>((artifact) => ({
    action: {
      sessionId: artifact.conversationId,
      slug: artifact.slug,
      type: "open-artifact",
    },
    at: artifact.at,
    ...(artifact.body ? { body: artifact.body } : {}),
    id: artifact.id,
    read: artifact.read,
    scope: "artifacts",
    sessionTitle: sessionTitle(piSessions, artifact.conversationId),
    title: artifact.title,
  }));

  return [...notificationRows, ...artifactRows].sort((a, b) => b.at - a.at);
}

export function countInboxUnread({
  artifacts = [],
  notifications,
}: CountInboxUnreadInput): InboxUnreadCounts {
  let code = 0;
  let chat = 0;
  let inbox = 0;

  for (const notification of notifications) {
    const scope = notificationScope(notification);
    if (!scope || notification.read) continue;
    inbox += 1;
    if (scope === "runs") code += 1;
    if (scope === "chat" || scope === "artifacts") chat += 1;
  }

  for (const artifact of artifacts) {
    if (artifact.read) continue;
    inbox += 1;
    chat += 1;
  }

  return { chat, code, inbox };
}
