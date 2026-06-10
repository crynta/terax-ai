import { randomUUID } from "node:crypto";

export const SESSION_EVENT = Object.freeze({
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
  QuestionRequested: "session.question.requested",
  QuestionResponded: "session.question.responded",
  QuestionCancelled: "session.question.cancelled",
  Archived: "session.archived",
  Restored: "session.restored",
  Forked: "session.forked",
  Rollback: "session.rollback",
  Usage: "session.usage",
  TurnDiff: "session.turn_diff",
});

export const SESSION_EVENT_PAYLOAD_FIELDS = Object.freeze({
  [SESSION_EVENT.Created]: ["session"],
  [SESSION_EVENT.Resumed]: ["session"],
  [SESSION_EVENT.Input]: ["text", "context", "thinkingLevel", "branch"],
  [SESSION_EVENT.Progress]: ["text", "branch"],
  [SESSION_EVENT.ReasoningDelta]: ["text", "branch"],
  [SESSION_EVENT.ReasoningText]: ["text", "branch"],
  [SESSION_EVENT.OutputDelta]: ["text", "branch"],
  [SESSION_EVENT.OutputText]: ["text", "branch"],
  [SESSION_EVENT.ToolStart]: ["toolCallId", "toolName", "input", "branch"],
  [SESSION_EVENT.ToolUpdate]: ["toolCallId", "toolName", "input", "output", "branch"],
  [SESSION_EVENT.ToolApprovalRequested]: [
    "approvalId",
    "toolCallId",
    "toolName",
    "input",
    "branch",
  ],
  [SESSION_EVENT.ToolApprovalResponded]: [
    "approvalId",
    "toolCallId",
    "toolName",
    "input",
    "approved",
    "branch",
  ],
  [SESSION_EVENT.ToolResult]: [
    "toolCallId",
    "toolName",
    "input",
    "output",
    "errorText",
    "isError",
    "branch",
  ],
  [SESSION_EVENT.Status]: ["status", "branch"],
  [SESSION_EVENT.Renamed]: ["title"],
  [SESSION_EVENT.Deleted]: ["sessionId"],
  [SESSION_EVENT.Error]: ["message", "branch"],
  [SESSION_EVENT.QuestionRequested]: ["questionId", "prompt", "options"],
  [SESSION_EVENT.QuestionResponded]: ["questionId", "answers"],
  [SESSION_EVENT.QuestionCancelled]: ["questionId"],
  [SESSION_EVENT.Archived]: ["sessionId"],
  [SESSION_EVENT.Restored]: ["sessionId"],
  [SESSION_EVENT.Forked]: ["sessionId", "parentSessionId", "forkEventId"],
  [SESSION_EVENT.Rollback]: ["sessionId", "rollbackEventId", "removedEventCount"],
  [SESSION_EVENT.Usage]: ["inputTokens", "outputTokens", "cachedInputTokens", "costUsd", "modelId", "providerId"],
  [SESSION_EVENT.TurnDiff]: ["inputEventId", "files", "commands", "usage", "toolCalls"],
});

let nextEventNumber = 1;
let sessionEventSink = () => {};

export function isoNow() {
  return new Date().toISOString();
}

function shortRandomId() {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function timestampIdPart() {
  return Date.now().toString(36);
}

export function createSessionId() {
  return `pi_${timestampIdPart()}_${shortRandomId()}`;
}

function createEventId(sequence) {
  return `evt_${timestampIdPart()}_${sequence}_${shortRandomId()}`;
}

export function createBranchGroupId() {
  return `turn_${timestampIdPart()}_${shortRandomId()}`;
}

export function sessionSnapshot(session) {
  const {
    agentSession: _agentSession,
    unsubscribe: _unsubscribe,
    cleanup: _cleanup,
    activeRunId: _activeRunId,
    cancelledRunId: _cancelledRunId,
    providerConfig: _providerConfig,
    sessionDir: _sessionDir,
    autoTitle: _autoTitle,
    agentGeneration: _agentGeneration,
    branchGroups: _branchGroups,
    activeBranch: _activeBranch,
    toolInputs: _toolInputs,
    pendingApprovals: _pendingApprovals,
    capabilityManifest: _capabilityManifest,
    _turnEvents: _turnEvents,
    _turnInputEventId: _turnInputEventId,
    ...snapshot
  } = session;
  return { ...snapshot };
}

function sessionEvent(type, sessionId, payload, createdAt = isoNow()) {
  const sequence = nextEventNumber;
  return {
    id: createEventId(sequence),
    type,
    sessionId,
    createdAt,
    payload,
  };
}

export function pushEvent(type, sessionId, payload, createdAt) {
  const event = sessionEvent(type, sessionId, payload, createdAt);
  nextEventNumber += 1;
  return event;
}

export function publishEvent(type, sessionId, payload, createdAt) {
  const event = pushEvent(type, sessionId, payload, createdAt);
  sessionEventSink(event);
  return event;
}

export function setSessionEventSink(sink) {
  sessionEventSink = typeof sink === "function" ? sink : () => {};
}

export function resetSessionEventsForTests() {
  nextEventNumber = 1;
}
