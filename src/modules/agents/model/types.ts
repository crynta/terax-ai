export const AGENT_STATES = [
  "starting",
  "working",
  "needs-input",
  "needs-approval",
  "done",
  "error",
  "idle",
  "exited",
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

export type WaitingReason =
  | "permission"
  | "input"
  | "idle"
  | "elicitation"
  | "attention"
  | "error";

/** Where the freshest evidence about an agent came from, strongest last. */
export type Provenance = "process" | "osc" | "hook";

export type HookEventKind =
  | "session-start"
  | "prompt"
  | "tool-start"
  | "tool-end"
  | "permission-request"
  | "permission-resolved"
  | "notification"
  | "stop"
  | "stop-failure"
  | "interrupt"
  | "subagent-start"
  | "subagent-stop"
  | "session-end";

export type ToolInfo = {
  name: string;
  inputPreview: string;
  id?: string;
  error?: boolean;
};

export type PermissionSuggestion = { label: string };

export type PermissionInfo = {
  requestId?: string;
  tool: string;
  inputPreview: string;
  suggestions?: PermissionSuggestion[];
  /** Set on `permission-resolved`: allow, deny, ask, timeout, agent-gone, ... */
  outcome?: string;
};

export type SubagentInfo = {
  id: string;
  type: string;
  state: "running" | "done";
};

/** Payload of the native `terax:agent-event` event. */
export type AgentHookEvent = {
  paneId: number;
  ptyId: number;
  agent: string;
  kind: HookEventKind;
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  message?: string;
  notificationType?: string;
  reason?: string;
  tool?: ToolInfo;
  permission?: PermissionInfo;
  subagent?: SubagentInfo;
  at: number;
};

export type AgentSignalKind =
  | "started"
  | "working"
  | "attention"
  | "finished"
  | "exited";

/** Payload of the native `terax:agent-signal` event (process and OSC state). */
export type AgentSignalEvent = {
  id: number;
  kind: AgentSignalKind;
  agent?: string | null;
};

export type AgentModelEvent =
  | { type: "hook"; event: AgentHookEvent }
  | { type: "signal"; signal: AgentSignalEvent; at: number }
  | { type: "acknowledge"; ptyId: number; at: number }
  | { type: "remove"; ptyId: number };

export type SubagentSummary = {
  id: string;
  type: string;
  state: "running" | "done";
  startedAt: number;
  endedAt: number | null;
  message: string | null;
};

export type CurrentTool = {
  id: string | null;
  name: string;
  inputPreview: string;
  startedAt: number;
};

export type PendingPermission = {
  /** Present when Terax can answer; absent when only the agent's own prompt can. */
  requestId: string | null;
  tool: string;
  inputPreview: string;
  suggestions: PermissionSuggestion[];
  at: number;
};

export type Agent = {
  ptyId: number;
  paneId: number | null;
  agent: string;
  state: AgentState;
  waitingReason: WaitingReason | null;
  sessionId: string | null;
  transcriptPath: string | null;
  cwd: string | null;
  lastMessage: string | null;
  lastPrompt: string | null;
  /** The most recently started tool that has not ended. */
  currentTool: CurrentTool | null;
  /** Tools that started and have not ended, by tool id (name and input without one). */
  runningTools: Readonly<Record<string, CurrentTool>>;
  subagents: Readonly<Record<string, SubagentSummary>>;
  /** Approvals the agent is blocked on, oldest first; a terminal can have several. */
  pendingPermissions: readonly PendingPermission[];
  /** Prompts submitted in this run of the agent. */
  turn: number;
  provenance: Provenance;
  startedAt: number;
  updatedAt: number;
  stateSince: number;
  /** Since when the agent has needed the user; null when it does not. */
  attentionSince: number | null;
};

export type AgentRegistry = Readonly<Record<number, Agent>>;
