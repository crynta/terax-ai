export type AgentStatus = "working" | "waiting";

export type AgentSource = "terminal" | "local";

type AgentSignalKind =
  | "started"
  | "working"
  | "attention"
  | "finished"
  | "exited"
  | "linked";

export type AgentSignal = {
  id: number;
  kind: AgentSignalKind;
  agent: string | null;
  /** The agent's own session id (UUID), on `linked` signals only. */
  session?: string | null;
};

export type AgentSession = {
  leafId: number;
  tabId: number;
  agent: string;
  status: AgentStatus;
  startedAt: number;
  lastActivityAt: number;
  attentionSince: number | null;
  /** Claude Code session id, once its hook reports it (opens the transcript). */
  claudeSessionId: string | null;
};

export type AgentNotification = {
  id: string;
  source: AgentSource;
  leafId: number;
  tabId: number;
  agent: string;
  kind: NotificationKind;
  at: number;
  read: boolean;
};

export type NotificationKind = "attention" | "finished" | "error";

export type LocalAgentState = {
  agent: string;
  status: AgentStatus;
} | null;
