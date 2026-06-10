/**
 * Translates pi-agent-core {@link AgentEvent}s into Terax {@link PiSessionEvent}s.
 *
 * This is the single source of truth for turning the SDK's streaming agent
 * events into the transcript events the UI consumes. It exists as a pure,
 * stateless-per-call function so the translation rules can be tested directly
 * (the old inline version lived inside a closure in webview-session.ts and was
 * impossible to test, which let two bugs hide):
 *
 *  - It relies on the SDK-provided `assistantMessageEvent` deltas
 *    (`text_delta` / `thinking_delta`) instead of recomputing deltas from
 *    content-block indices. The old hand-rolled approach tracked text by block
 *    index across an entire turn, so a second assistant message (after a tool
 *    call) collided with the first message's longer text and dropped output.
 *  - It surfaces thinking/reasoning as reasoning events, which the old emitter
 *    ignored entirely.
 *
 * Session-level concerns (usage, turn-diff, status, input) stay in the caller;
 * this only covers the assistant transcript: output text, reasoning, and tool
 * activity.
 */
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { PI_SESSION_EVENT, type PiSessionEvent } from "./types";

export type AgentEventTranslatorDeps = {
  sessionId: string;
  /** Generates a unique event id. */
  newId: () => string;
  /** Returns the current ISO timestamp. */
  now: () => string;
};

export type AgentEventTranslator = {
  /** Translate a single AgentEvent into zero or more PiSessionEvents. */
  translate: (event: AgentEvent) => PiSessionEvent[];
};

type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: string; [key: string]: unknown };

export function createAgentEventTranslator(
  deps: AgentEventTranslatorDeps,
): AgentEventTranslator {
  const { sessionId, newId, now } = deps;

  function event(
    type: string,
    payload: Record<string, unknown>,
  ): PiSessionEvent {
    return { id: newId(), type, sessionId, createdAt: now(), payload };
  }

  function finalText(content: AssistantContentBlock[]): string {
    return content
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("");
  }

  function finalThinking(content: AssistantContentBlock[]): string {
    return content
      .filter(
        (block): block is { type: "thinking"; thinking: string } =>
          block.type === "thinking" &&
          typeof (block as { thinking?: unknown }).thinking === "string",
      )
      .map((block) => block.thinking)
      .join("");
  }

  function translate(agentEvent: AgentEvent): PiSessionEvent[] {
    switch (agentEvent.type) {
      case "message_update": {
        const streamEvent = agentEvent.assistantMessageEvent;
        if (streamEvent?.type === "text_delta" && streamEvent.delta) {
          return [
            event(PI_SESSION_EVENT.OutputDelta, { text: streamEvent.delta }),
          ];
        }
        if (streamEvent?.type === "thinking_delta" && streamEvent.delta) {
          return [
            event(PI_SESSION_EVENT.ReasoningDelta, { text: streamEvent.delta }),
          ];
        }
        return [];
      }

      case "message_end": {
        const message = agentEvent.message;
        const content =
          message && "content" in message && Array.isArray(message.content)
            ? (message.content as AssistantContentBlock[])
            : [];
        const events: PiSessionEvent[] = [];
        const thinking = finalThinking(content);
        if (thinking.length > 0) {
          events.push(
            event(PI_SESSION_EVENT.ReasoningText, { text: thinking }),
          );
        }
        const text = finalText(content);
        if (text.length > 0) {
          events.push(event(PI_SESSION_EVENT.OutputText, { text }));
        }
        return events;
      }

      case "tool_execution_start":
        return [
          event(PI_SESSION_EVENT.ToolStart, {
            toolName: agentEvent.toolName,
            toolCallId: agentEvent.toolCallId,
            input: agentEvent.args,
          }),
        ];

      case "tool_execution_end":
        return [
          event(PI_SESSION_EVENT.ToolResult, {
            toolName: agentEvent.toolName,
            toolCallId: agentEvent.toolCallId,
            output: {
              content:
                typeof agentEvent.result === "string"
                  ? agentEvent.result
                  : JSON.stringify(agentEvent.result),
              details: agentEvent.result,
            },
            isError: agentEvent.isError,
          }),
        ];

      default:
        return [];
    }
  }

  return { translate };
}
