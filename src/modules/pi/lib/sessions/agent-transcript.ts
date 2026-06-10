/**
 * Durable persistence + safe rehydration for a Pi session's canonical
 * conversation transcript (`AgentMessage[]` from pi-agent-core).
 *
 * The webview Pi agent keeps its message history only in memory, so a restart
 * (or eviction) loses the ability to resume, fork, or rollback a session. This
 * primitive captures the SDK's own transcript so a fresh Agent can be seeded
 * from it. The event log is *not* a suitable source: the Rust store caps events
 * globally at 500 and flattens streamed deltas, whereas the AgentMessage[] is
 * the lossless, provider-ready representation.
 *
 * `prepareTranscriptForResume` is the load-bearing piece. A transcript may be
 * persisted in a shape no provider will accept on the next request:
 *  - a trailing assistant `toolCall` with no `toolResult` (killed mid-tool), or
 *  - a `toolResult` with no preceding `toolCall` (orphan).
 * Anthropic in particular rejects both. We repair the transcript to a clean
 * boundary so continuation produces a well-formed request, without fabricating
 * tool output.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  chronologicalEvents,
  eventText,
  eventTimestamp,
  eventToolCallId,
  eventToolName,
  eventToolOutput,
} from "./events";
import { PI_SESSION_EVENT, type PiSessionEvent } from "./types";

const TRANSCRIPT_VERSION = 1;

type SerializedTranscript = {
  version: number;
  messages: AgentMessage[];
};

type ContentBlock = { type?: string; id?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Serialize a transcript for durable storage. */
export function serializeAgentTranscript(messages: AgentMessage[]): string {
  const envelope: SerializedTranscript = {
    version: TRANSCRIPT_VERSION,
    messages,
  };
  return JSON.stringify(envelope);
}

/**
 * Deserialize a stored transcript. Returns an empty array for anything that
 * isn't a recognizable transcript envelope — corruption must never throw and
 * never crash session restore.
 */
export function deserializeAgentTranscript(raw: string): AgentMessage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    return [];
  }
  return parsed.messages as AgentMessage[];
}

function contentBlocks(message: AgentMessage): ContentBlock[] {
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

/**
 * Repair a transcript so the next provider request is well-formed:
 *  - drop `toolResult` messages whose `toolCallId` has no matching `toolCall`,
 *  - strip assistant `toolCall` blocks that never received a `toolResult`,
 *  - drop assistant messages left with no content after stripping.
 */
export function prepareTranscriptForResume(
  messages: AgentMessage[],
): AgentMessage[] {
  // Collect the tool-call ids that actually received a result.
  const resolvedToolCallIds = new Set<string>();
  for (const message of messages) {
    if ((message as { role?: string }).role === "toolResult") {
      const id = (message as { toolCallId?: string }).toolCallId;
      if (typeof id === "string") resolvedToolCallIds.add(id);
    }
  }

  // Collect the tool-call ids that were actually issued by an assistant.
  const issuedToolCallIds = new Set<string>();
  for (const message of messages) {
    if ((message as { role?: string }).role !== "assistant") continue;
    for (const block of contentBlocks(message)) {
      if (block.type === "toolCall" && typeof block.id === "string") {
        issuedToolCallIds.add(block.id);
      }
    }
  }

  const repaired: AgentMessage[] = [];
  for (const message of messages) {
    const role = (message as { role?: string }).role;

    if (role === "toolResult") {
      const id = (message as { toolCallId?: string }).toolCallId;
      // Drop orphan results — no assistant ever asked for them.
      if (typeof id === "string" && issuedToolCallIds.has(id)) {
        repaired.push(message);
      }
      continue;
    }

    if (role === "assistant") {
      const blocks = contentBlocks(message);
      const hasToolCalls = blocks.some((block) => block.type === "toolCall");
      if (!hasToolCalls) {
        repaired.push(message);
        continue;
      }
      const kept = blocks.filter(
        (block) =>
          block.type !== "toolCall" ||
          (typeof block.id === "string" && resolvedToolCallIds.has(block.id)),
      );
      // Drop an assistant message that became empty (it was only a dangling call).
      if (kept.length === 0) continue;
      repaired.push({ ...(message as object), content: kept } as AgentMessage);
      continue;
    }

    repaired.push(message);
  }

  return repaired;
}

type ToolCallBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

type AssistantAccumulator = { text: string; toolCalls: ToolCallBlock[] };

/**
 * Reconstruct a canonical `AgentMessage[]` from a session's persisted event
 * log. Used by fork and rollback: the Rust commands truncate the event log
 * authoritatively, so rebuilding the agent transcript from whatever events
 * remain sidesteps any need to correlate an event id to a message boundary.
 *
 * Reasoning/thinking blocks are intentionally dropped — they carry provider
 * signatures that aren't persisted and would be rejected on replay. The result
 * should be passed through {@link prepareTranscriptForResume} before seeding an
 * agent, to repair any tool-call/result pairing left dangling by truncation.
 */
export function eventsToAgentMessages(
  events: PiSessionEvent[],
): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let current: AssistantAccumulator | null = null;
  let lastTimestamp = 0;

  const flush = () => {
    if (!current) return;
    const content: Array<{ type: "text"; text: string } | ToolCallBlock> = [];
    if (current.text.length > 0) {
      content.push({ type: "text", text: current.text });
    }
    content.push(...current.toolCalls);
    if (content.length > 0) {
      messages.push({
        role: "assistant",
        content,
        api: "",
        provider: "",
        model: "",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: lastTimestamp,
      } as unknown as AgentMessage);
    }
    current = null;
  };

  for (const event of chronologicalEvents(events)) {
    lastTimestamp = eventTimestamp(event);
    switch (event.type) {
      case PI_SESSION_EVENT.Input: {
        flush();
        messages.push({
          role: "user",
          content: eventText(event) ?? "",
          timestamp: lastTimestamp,
        } as unknown as AgentMessage);
        break;
      }
      case PI_SESSION_EVENT.OutputText: {
        // A new text message after a tool call starts a fresh assistant turn.
        if (current && current.toolCalls.length > 0) flush();
        if (!current) current = { text: "", toolCalls: [] };
        current.text += eventText(event) ?? "";
        break;
      }
      case PI_SESSION_EVENT.ToolStart: {
        if (!current) current = { text: "", toolCalls: [] };
        const id = eventToolCallId(event);
        const name = eventToolName(event);
        if (id && name) {
          const args = event.payload.input;
          current.toolCalls.push({
            type: "toolCall",
            id,
            name,
            arguments:
              args && typeof args === "object"
                ? (args as Record<string, unknown>)
                : {},
          });
        }
        break;
      }
      case PI_SESSION_EVENT.ToolResult: {
        // Flush the assistant message holding this call before its result.
        flush();
        const id = eventToolCallId(event);
        const name = eventToolName(event);
        if (id && name) {
          messages.push({
            role: "toolResult",
            toolCallId: id,
            toolName: name,
            content: [
              { type: "text", text: eventToolOutput(event)?.content ?? "" },
            ],
            isError: event.payload.isError === true,
            timestamp: lastTimestamp,
          } as unknown as AgentMessage);
        }
        break;
      }
      default:
        // Reasoning, status, usage, progress, lifecycle — not part of the
        // model-visible transcript.
        break;
    }
  }
  flush();
  return messages;
}
