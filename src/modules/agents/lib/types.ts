export type AgentStatus = "working" | "waiting" | "finished" | "idle" | "error";

export type AgentSource = "terminal" | "local" | "pi";

export type AgentNotificationCategory =
  | "code-run"
  | "chat-response"
  | "artifact";

export type AgentSurfaceStatus =
  | "attention"
  | "working"
  | "idle"
  | "finished"
  | "error";

export type AgentSignalKind =
  | "started"
  | "working"
  | "attention"
  | "finished"
  | "exited";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
};

export type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: AgentStatus;
  startedAt: number;
  lastActivityAt: number;
  attentionSince: number | null;
};

export type AgentNotification = {
  id: string;
  source: AgentSource;
  leafId: number;
  tabId: number;
  agent: string;
  kind: NotificationKind;
  at: number;
  category?: AgentNotificationCategory;
  read: boolean;
  title?: string;
  body?: string;
  piSessionId?: string;
};

export type NotificationKind = "attention" | "finished" | "error";

export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
  startedAt?: number;
  lastActivityAt?: number;
  attentionSince?: number | null;
} | null;

export type PiAgentSessionState = {
  sessionId: string;
  title: string;
  status: AgentSurfaceStatus;
  lastActivityAt: number;
  body?: string;
  cwd?: string | null;
  attentionSince?: number | null;
};
