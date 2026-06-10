import { publishEvent, SESSION_EVENT } from "./session-events.js";
import {
  compactToolResult,
  outputPayload,
  serializableValue,
  toolPayload,
  toolResultText,
} from "./session-payloads.js";

// ─── Turn-diff computation (mirrors turn-diff.ts) ───

const FILE_TOOL_NAMES = new Set(["read", "write_file", "edit_file", "write", "edit"]);
const SHELL_TOOL_NAMES = new Set(["bash_run", "bash", "shell"]);

const FILE_ACTION_PRIORITY = { read: 0, edited: 1, written: 2, created: 3, deleted: 4 };

function mergeFileChange(fileMap, change) {
  const existing = fileMap.get(change.path);
  if (!existing) {
    fileMap.set(change.path, change);
    return;
  }
  if ((FILE_ACTION_PRIORITY[change.action] ?? 0) > (FILE_ACTION_PRIORITY[existing.action] ?? 0)) {
    existing.action = change.action;
  }
}

function extractFilePath(input) {
  if (!input || typeof input !== "object") return null;
  const obj = input;
  for (const key of ["path", "file_path", "filePath", "file"]) {
    if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim();
  }
  return null;
}

function extractCommand(input) {
  if (!input || typeof input !== "object") return null;
  const raw = input.command ?? input.cmd ?? null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Compute a structured summary of what changed during a turn.
 * Mirrors the logic in turn-diff.ts.
 */
function computeTurnDiff(events, fromEventId) {
  const fileMap = new Map();
  const commands = [];
  const toolCalls = [];
  let usage = null;

  // Find start point
  let inRange = fromEventId === null;
  const toolStarts = new Map();

  for (const event of events) {
    if (!inRange) {
      if (event.id === fromEventId) inRange = true;
      else continue;
    }

    const p = event.payload ?? {};

    if (event.type === SESSION_EVENT.ToolStart) {
      const callId = p.toolCallId;
      const name = p.toolName;
      toolStarts.set(callId, { name, callId, input: p.input });
    }

    if (event.type === SESSION_EVENT.ToolResult) {
      const callId = p.toolCallId;
      const name = p.toolName;
      const isError = p.isError === true;
      toolStarts.delete(callId);

      if (FILE_TOOL_NAMES.has(name)) {
        const filePath = extractFilePath(p.input);
        if (filePath) {
          const action = isError ? "read" : fileActionForTool(name);
          mergeFileChange(fileMap, { path: filePath, action });
        }
      } else if (SHELL_TOOL_NAMES.has(name)) {
        const cmd = extractCommand(p.input);
        if (cmd) {
          commands.push({ command: cmd, exitCode: isError ? 1 : 0 });
        }
      } else {
        toolCalls.push({ toolName: name, success: !isError });
      }
    }

    if (event.type === SESSION_EVENT.Usage) {
      usage = {
        inputTokens: p.inputTokens ?? 0,
        outputTokens: p.outputTokens ?? 0,
        cachedInputTokens: p.cachedInputTokens ?? null,
      };
    }
  }

  // Unmatched tool starts
  for (const [, meta] of toolStarts) {
    if (FILE_TOOL_NAMES.has(meta.name)) {
      const filePath = extractFilePath(meta.input);
      if (filePath) {
        mergeFileChange(fileMap, { path: filePath, action: fileActionForTool(meta.name) });
      }
    } else if (SHELL_TOOL_NAMES.has(meta.name)) {
      const cmd = extractCommand(meta.input);
      if (cmd) commands.push({ command: cmd, exitCode: null });
    } else {
      toolCalls.push({ toolName: meta.name, success: false });
    }
  }

  const files = Array.from(fileMap.values());
  return { files, commands, usage, toolCalls };
}

function fileActionForTool(toolName) {
  switch (toolName) {
    case "read": case "read_file": return "read";
    case "edit": case "edit_file": return "edited";
    case "write": case "write_file": return "written";
    default: return "read";
  }
}

/** Initialize per-session turn event collector */
export function initTurnEventCollector(session) {
  session._turnEvents = [];
  session._turnInputEventId = null;
}

export function mapAgentSessionEvent(
  event,
  session,
  agentGeneration = session.agentGeneration,
) {
  if (session.status !== "running") {
    return null;
  }
  if (agentGeneration !== session.agentGeneration) {
    return null;
  }
  if (session.cancelledRunId === session.activeRunId) {
    return null;
  }

  // Helper: publish and record in turn collector
  function publishAndRecord(type, sessionId, payload) {
    const evt = publishEvent(type, sessionId, payload);
    if (session._turnEvents) {
      session._turnEvents.push({ id: evt.id, type, payload });
    }
    return evt;
  }

  switch (event.type) {
    case "agent_start":
      return publishEvent(
        SESSION_EVENT.Progress,
        session.id,
        outputPayload(session, "Starting Pi run…"),
      );
    case "turn_start":
      return publishEvent(
        SESSION_EVENT.Progress,
        session.id,
        outputPayload(session, "Preparing model request…"),
      );
    case "message_start":
      if (event.message?.role === "assistant") {
        return publishEvent(
          SESSION_EVENT.Progress,
          session.id,
          outputPayload(session, "Receiving response…"),
        );
      }
      return null;
    case "message_update": {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent?.type === "thinking_start") {
        return publishEvent(
          SESSION_EVENT.Progress,
          session.id,
          outputPayload(session, "Reasoning…"),
        );
      }
      if (assistantEvent?.type === "thinking_delta") {
        return publishEvent(
          SESSION_EVENT.ReasoningDelta,
          session.id,
          outputPayload(session, assistantEvent.delta),
        );
      }
      if (assistantEvent?.type === "thinking_end") {
        return publishEvent(
          SESSION_EVENT.ReasoningText,
          session.id,
          outputPayload(session, assistantEvent.content),
        );
      }
      if (assistantEvent?.type === "text_start") {
        return publishEvent(
          SESSION_EVENT.Progress,
          session.id,
          outputPayload(session, "Writing response…"),
        );
      }
      if (assistantEvent?.type === "text_delta") {
        return publishEvent(
          SESSION_EVENT.OutputDelta,
          session.id,
          outputPayload(session, assistantEvent.delta),
        );
      }
      if (assistantEvent?.type === "text_end") {
        return publishEvent(
          SESSION_EVENT.OutputText,
          session.id,
          outputPayload(session, assistantEvent.content),
        );
      }
      return null;
    }
    case "tool_execution_start":
      session.toolInputs.set(event.toolCallId, serializableValue(event.args));
      return publishAndRecord(
        SESSION_EVENT.ToolStart,
        session.id,
        toolPayload(session, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: serializableValue(event.args),
        }),
      );
    case "tool_execution_update":
      return publishEvent(
        SESSION_EVENT.ToolUpdate,
        session.id,
        toolPayload(session, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input:
            session.toolInputs.get(event.toolCallId) ??
            serializableValue(event.args),
          output: compactToolResult(event.partialResult),
        }),
      );
    case "tool_execution_end": {
      const input = session.toolInputs.get(event.toolCallId);
      session.toolInputs.delete(event.toolCallId);
      const payload = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: compactToolResult(event.result),
        errorText: event.isError ? toolResultText(event.result) : undefined,
        isError: event.isError === true,
      };
      if (input !== undefined) payload.input = input;
      return publishAndRecord(
        SESSION_EVENT.ToolResult,
        session.id,
        toolPayload(session, payload),
      );
    }
    case "auto_retry_start":
      return publishEvent(
        SESSION_EVENT.Progress,
        session.id,
        outputPayload(
          session,
          `Retrying (${event.attempt}/${event.maxAttempts})…`,
        ),
      );
    case "compaction_start":
      return publishEvent(
        SESSION_EVENT.Progress,
        session.id,
        outputPayload(session, "Compacting context…"),
      );

    case "agent_end": {
      // Emit usage telemetry from totalUsage
      const totalUsage = event.totalUsage;
      if (totalUsage) {
        const usagePayload = {
          inputTokens: totalUsage.inputTokens ?? 0,
          outputTokens: totalUsage.outputTokens ?? 0,
          cachedInputTokens:
            totalUsage.inputTokenDetails?.cacheReadTokens ?? null,
          modelId: session.providerConfig?.modelId ?? null,
          providerId: session.providerConfig?.provider ?? null,
        };
        const usageEvent = publishAndRecord(
          SESSION_EVENT.Usage,
          session.id,
          usagePayload,
        );
      }

      // Emit turn-diff if we collected events for this turn
      if (session._turnEvents && session._turnInputEventId) {
        const diff = computeTurnDiff(session._turnEvents, session._turnInputEventId);
        if (
          diff.files.length > 0 ||
          diff.commands.length > 0 ||
          diff.toolCalls.length > 0 ||
          diff.usage
        ) {
          publishEvent(SESSION_EVENT.TurnDiff, session.id, {
            inputEventId: session._turnInputEventId,
            files: diff.files,
            commands: diff.commands,
            usage: diff.usage,
            toolCalls: diff.toolCalls,
          });
        }
        // Reset collector
        session._turnEvents = [];
        session._turnInputEventId = null;
      }
      return null;
    }
  }

  return null;
}
