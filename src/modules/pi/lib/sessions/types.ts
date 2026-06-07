import type { PiThinkingLevel } from "@/modules/pi/lib/provider";
import type { WorkspaceEnv } from "@/modules/workspace";

export const PI_SESSION_EVENT_TYPES = [
  "session.created",
  "session.resumed",
  "session.input",
  "session.progress",
  "session.reasoning.delta",
  "session.reasoning.text",
  "session.output.delta",
  "session.output.text",
  "session.tool.start",
  "session.tool.update",
  "session.tool.approval.requested",
  "session.tool.approval.responded",
  "session.tool.result",
  "session.status",
  "session.renamed",
  "session.deleted",
  "session.error",
] as const;

export type PiSessionEventType = (typeof PI_SESSION_EVENT_TYPES)[number];

export const PI_SESSION_EVENT = Object.freeze({
  Created: "session.created",
  Resumed: "session.resumed",
  Input: "session.input",
  Progress: "session.progress",
  ReasoningDelta: "session.reasoning.delta",
  ReasoningText: "session.reasoning.text",
  OutputDelta: "session.output.delta",
  OutputText: "session.output.text",
  ToolStart: "session.tool.start",
  ToolUpdate: "session.tool.update",
  ToolApprovalRequested: "session.tool.approval.requested",
  ToolApprovalResponded: "session.tool.approval.responded",
  ToolResult: "session.tool.result",
  Status: "session.status",
  Renamed: "session.renamed",
  Deleted: "session.deleted",
  Error: "session.error",
} satisfies Record<string, PiSessionEventType>);

export function isPiSessionEventType(
  value: unknown,
): value is PiSessionEventType {
  return (
    typeof value === "string" &&
    (PI_SESSION_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export type PiSessionStatus = "idle" | "running" | "stopped" | "error";

export type PiSession = {
  id: string;
  title: string;
  cwd?: string | null;
  status: PiSessionStatus;
  createdAt: string;
  updatedAt: string;
  lastPrompt: string | null;
  workspaceEnv?: WorkspaceEnv | null;
  thinkingLevel?: PiThinkingLevel | null;
  sdkSessionFile?: string | null;
};

export type PiPromptContext = {
  workspaceRoot?: string | null;
  activeTerminalCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
};

export type PiSessionEventPayload = Record<string, unknown>;

export type PiSessionEventBranchPayload = {
  branch?: PiSessionBranch;
};

export type PiSessionTextPayload = PiSessionEventBranchPayload & {
  text: string;
};

export type PiSessionInputPayload = PiSessionTextPayload & {
  context?: PiPromptContext;
  thinkingLevel?: PiThinkingLevel | null;
};

export type PiSessionToolPayload = PiSessionEventBranchPayload & {
  approvalId?: string;
  approved?: boolean;
  errorText?: string;
  input?: unknown;
  isError?: boolean;
  output?: PiToolOutput;
  toolCallId: string;
  toolName: string;
};

export type PiSessionEventPayloadByType = {
  [PI_SESSION_EVENT.Created]: { session: PiSession };
  [PI_SESSION_EVENT.Resumed]: { session: PiSession };
  [PI_SESSION_EVENT.Input]: PiSessionInputPayload;
  [PI_SESSION_EVENT.Progress]: PiSessionTextPayload;
  [PI_SESSION_EVENT.ReasoningDelta]: PiSessionTextPayload;
  [PI_SESSION_EVENT.ReasoningText]: PiSessionTextPayload;
  [PI_SESSION_EVENT.OutputDelta]: PiSessionTextPayload;
  [PI_SESSION_EVENT.OutputText]: PiSessionTextPayload;
  [PI_SESSION_EVENT.ToolStart]: PiSessionToolPayload;
  [PI_SESSION_EVENT.ToolUpdate]: PiSessionToolPayload;
  [PI_SESSION_EVENT.ToolApprovalRequested]: PiSessionToolPayload & {
    approvalId: string;
  };
  [PI_SESSION_EVENT.ToolApprovalResponded]: PiSessionToolPayload & {
    approvalId: string;
    approved: boolean;
  };
  [PI_SESSION_EVENT.ToolResult]: PiSessionToolPayload;
  [PI_SESSION_EVENT.Status]: {
    status: PiSessionStatus;
  } & PiSessionEventBranchPayload;
  [PI_SESSION_EVENT.Renamed]: { title: string };
  [PI_SESSION_EVENT.Deleted]: { sessionId: string };
  [PI_SESSION_EVENT.Error]: { message: string } & PiSessionEventBranchPayload;
};

export type PiKnownSessionEvent<
  Type extends PiSessionEventType = PiSessionEventType,
> = {
  [EventType in Type]: {
    id: string;
    type: EventType;
    sessionId: string;
    createdAt: string;
    payload: PiSessionEventPayloadByType[EventType];
  };
}[Type];

export type PiSessionEvent = {
  id: string;
  type: PiSessionEventType | (string & {});
  sessionId: string;
  createdAt: string;
  payload: PiSessionEventPayload;
};

export function isKnownPiSessionEvent<Type extends PiSessionEventType>(
  event: PiSessionEvent,
  type: Type,
): event is PiKnownSessionEvent<Type> {
  return event.type === type;
}

export type PiSessionsList = {
  sessions: PiSession[];
  events: PiSessionEvent[];
};

export type PiSessionCreateResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionSendResult = {
  accepted: boolean;
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionResumeResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionRenameResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionDeleteResult = {
  events: PiSessionEvent[];
};

export type PiArtifactDeleteResult = {
  deleted: boolean;
  deletedCount?: number;
};

export type PiSessionDeleteWithArtifactsResult = {
  sessionDelete: PiSessionDeleteResult;
  artifactDelete: PiArtifactDeleteResult | null;
  artifactCleanupError: string | null;
};

export type PiSessionToolRespondResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionStopResult = {
  session: PiSession;
  events: PiSessionEvent[];
};

export type PiSessionBranch = {
  groupId: string;
  index: number;
  regeneratedFromEventId?: string | null;
};

export type PiTranscriptBranch = {
  id: string;
  branchIndex: number;
  text: string | null;
  reasoningText?: string | null;
  eventIds: string[];
  reasoningEventIds?: string[];
  createdAt: string;
};

export type PiToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

export type PiToolOutput = {
  content: string;
  details: unknown | null;
};

export type PiTranscriptItem = {
  id: string;
  kind: "assistant" | "error" | "progress" | "system" | "tool" | "user";
  label: string;
  text: string | null;
  eventIds: string[];
  createdAt: string;
  context?: PiPromptContext;
  reasoningText?: string | null;
  reasoningEventIds?: string[];
  branchGroupId?: string;
  branchIndex?: number;
  branches?: PiTranscriptBranch[];
  promptText?: string | null;
  promptContext?: PiPromptContext;
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: PiToolOutput;
  toolState?: PiToolState;
  toolErrorText?: string | null;
  toolApprovalId?: string;
  toolApproved?: boolean | null;
};

export const MAX_PI_PROMPT_CHARS = 20_000;
