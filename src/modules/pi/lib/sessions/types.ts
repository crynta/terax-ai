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
  "session.archived",
  "session.restored",
  "session.forked",
  "session.rollback",
  "session.usage",
  "session.turn_diff",
  "session.question.asked",
  "session.question.responded",
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
  Archived: "session.archived",
  Restored: "session.restored",
  Forked: "session.forked",
  Rollback: "session.rollback",
  Usage: "session.usage",
  TurnDiff: "session.turn_diff",
  QuestionAsked: "session.question.asked",
  QuestionResponded: "session.question.responded",
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
  archivedAt?: string | null;
  forkedFrom?: PiSessionForkRef | null;
};

export type PiSessionForkRef = {
  parentSessionId: string;
  forkEventId?: string | null;
};

export type PiUsageRecord = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number | null;
  costUsd?: number | null;
  modelId?: string | null;
  providerId?: string | null;
  latencyMs?: number | null;
};

export type PiUsageModelBreakdown = {
  modelId: string;
  providerId?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  turnCount: number;
};

export type PiUsageSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedInputTokens: number;
  totalCostUsd: number;
  turnCount: number;
  byModel?: PiUsageModelBreakdown[] | null;
};

export type PiTurnDiffPayload = {
  /** The session.input event ID that started this turn */
  inputEventId: string;
  files: Array<{
    path: string;
    action: "read" | "edited" | "written" | "created" | "deleted";
  }>;
  commands: Array<{
    command: string;
    exitCode: number | null;
    durationMs: number | null;
  }>;
  usage: PiUsageRecord | null;
  toolCalls: Array<{ toolName: string; success: boolean }>;
};

export type PiPromptContext = {
  workspaceRoot?: string | null;
  activeTerminalCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
};

export type PiQuestionOption = {
  label: string;
  description?: string;
};

export type PiQuestionAnswer = {
  label: string;
  customText?: string | null;
};

type PiSessionEventPayload = Record<string, unknown>;

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
  [PI_SESSION_EVENT.Archived]: { sessionId: string };
  [PI_SESSION_EVENT.Restored]: { sessionId: string };
  [PI_SESSION_EVENT.Forked]: {
    parentSessionId: string;
    forkEventId?: string;
    session: PiSession;
  };
  [PI_SESSION_EVENT.Rollback]: {
    sessionId: string;
    rollbackEventId: string;
    removedEventCount: number;
  };
  [PI_SESSION_EVENT.Usage]: PiUsageRecord;
  [PI_SESSION_EVENT.TurnDiff]: PiTurnDiffPayload;
  [PI_SESSION_EVENT.QuestionAsked]: {
    questionId: string;
    question: string;
    options: PiQuestionOption[];
    allowMultiple?: boolean;
  };
  [PI_SESSION_EVENT.QuestionResponded]: {
    questionId: string;
    answers: PiQuestionAnswer[];
  };
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

type PiToolState =
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
  kind:
    | "assistant"
    | "error"
    | "progress"
    | "question"
    | "system"
    | "tool"
    | "user";
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
  questionId?: string;
  questionOptions?: PiQuestionOption[];
  questionAllowMultiple?: boolean;
  questionAnswers?: PiQuestionAnswer[];
  questionState?: "pending" | "answered";
};

export const MAX_PI_PROMPT_CHARS = 20_000;
