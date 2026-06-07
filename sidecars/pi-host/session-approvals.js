import { executeNativeTool } from "./native-tools.js";
import {
  publishEvent,
  pushEvent,
  SESSION_EVENT,
  isoNow,
} from "./session-events.js";
import {
  serializableValue,
  toolPayload,
  toolResultText,
} from "./session-payloads.js";
import { toolRequiresApproval, validateToolSafety } from "./tool-policy.js";

function toolApprovalPayload(session, approval, approved) {
  const payload = {
    approvalId: approval.toolCallId,
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
    input: approval.input,
  };
  if (typeof approved === "boolean") {
    payload.approved = approved;
  }
  return toolPayload(session, payload);
}

function pushToolApprovalRequested(session, approval, createdAt = isoNow()) {
  return publishEvent(
    SESSION_EVENT.ToolApprovalRequested,
    session.id,
    toolApprovalPayload(session, approval),
    createdAt,
  );
}

export function pushToolApprovalResponded(
  session,
  approval,
  approved,
  createdAt = isoNow(),
) {
  return pushEvent(
    SESSION_EVENT.ToolApprovalResponded,
    session.id,
    toolApprovalPayload(session, approval, approved),
    createdAt,
  );
}

function publishToolApprovalResponded(
  session,
  approval,
  approved,
  createdAt = isoNow(),
) {
  return publishEvent(
    SESSION_EVENT.ToolApprovalResponded,
    session.id,
    toolApprovalPayload(session, approval, approved),
    createdAt,
  );
}

export function resolvePendingApproval(session, approval, approved) {
  if (!session.pendingApprovals.has(approval.toolCallId)) {
    return;
  }
  session.pendingApprovals.delete(approval.toolCallId);
  approval.cleanup?.();
  approval.resolve(approved);
}

export function resolveAllPendingApprovals(
  session,
  approved,
  createdAt = isoNow(),
  mode = "push",
) {
  const events = [];
  for (const approval of Array.from(session.pendingApprovals.values())) {
    resolvePendingApproval(session, approval, approved);
    const event =
      mode === "publish"
        ? publishToolApprovalResponded(session, approval, approved, createdAt)
        : pushToolApprovalResponded(session, approval, approved, createdAt);
    events.push(event);
  }
  return events;
}

function waitForToolApproval(session, event, signal) {
  const toolName = event.toolName;
  const toolCallId = event.toolCallId;
  const input = serializableValue(event.input);
  const approval = {
    toolCallId,
    toolName,
    input,
    runId: session.activeRunId,
    cleanup: undefined,
    resolve: undefined,
  };

  const promise = new Promise((resolve) => {
    approval.resolve = resolve;
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const abort = () => resolvePendingApproval(session, approval, false);
    signal?.addEventListener("abort", abort, { once: true });
    approval.cleanup = () => signal?.removeEventListener("abort", abort);
    session.pendingApprovals.set(toolCallId, approval);
    pushToolApprovalRequested(session, approval);
  });

  return promise;
}

async function handleToolApprovalRequest(session, event, signal) {
  const toolName = event.toolName;
  const safetyMessage = validateToolSafety(session, toolName, event.input);
  if (safetyMessage !== null) {
    return { block: true, reason: safetyMessage };
  }

  if (!toolRequiresApproval(toolName, session)) {
    return undefined;
  }

  const approved = await waitForToolApproval(session, event, signal);
  return approved
    ? undefined
    : { block: true, reason: `Tool ${toolName} denied by user` };
}

function isMcpToolResultError(event) {
  if (typeof event.toolName !== "string" || !event.toolName.startsWith("mcp__")) {
    return false;
  }
  const details = event.details;
  if (!details || typeof details !== "object") return false;
  const mcp = details.mcp;
  return Boolean(mcp && typeof mcp === "object" && mcp.isError === true);
}

function handleToolResult(event) {
  if (!isMcpToolResultError(event) || event.isError === true) {
    return undefined;
  }
  return { isError: true };
}

export function createApprovalExtension(session) {
  return (pi) => {
    pi.on("tool_call", (event, context) =>
      handleToolApprovalRequest(session, event, context.signal),
    );
    pi.on("tool_result", (event) => handleToolResult(event));
  };
}
