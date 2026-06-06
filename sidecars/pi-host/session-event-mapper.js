import { publishEvent, SESSION_EVENT } from "./session-events.js";
import {
  compactToolResult,
  outputPayload,
  serializableValue,
  toolPayload,
  toolResultText,
} from "./session-payloads.js";

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
      return publishEvent(
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
      return publishEvent(
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
  }

  return null;
}
