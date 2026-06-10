/**
 * Tests for the agent transcript persistence/rehydration primitive.
 *
 * This is the foundation for resume-after-restart, fork, and rollback in the
 * webview Pi path: a session's canonical `AgentMessage[]` is serialized to
 * durable storage and later used to seed a fresh Agent.
 *
 * The non-trivial property is tool-call integrity. Most providers (Anthropic in
 * particular) reject a request whose assistant turn contains a `toolCall` with
 * no following `toolResult`, or a `toolResult` with no preceding `toolCall`.
 * A transcript persisted right after an assistant message — or after the app is
 * killed mid-tool-execution — has exactly that shape, so `prepareTranscriptForResume`
 * must repair it before the conversation can continue.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  deserializeAgentTranscript,
  eventsToAgentMessages,
  prepareTranscriptForResume,
  serializeAgentTranscript,
} from "./agent-transcript";
import { PI_SESSION_EVENT, type PiSessionEvent } from "./types";

function user(text: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: 1,
  } as unknown as AgentMessage;
}

function assistant(
  content: Array<
    | { type: "text"; text: string }
    | {
        type: "toolCall";
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }
  >,
): AgentMessage {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 2,
  } as unknown as AgentMessage;
}

function toolResult(toolCallId: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "read_file",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 3,
  } as unknown as AgentMessage;
}

function roles(messages: AgentMessage[]): string[] {
  return messages.map((m) => (m as { role: string }).role);
}

let eventSeq = 0;
function ev(type: string, payload: Record<string, unknown>): PiSessionEvent {
  eventSeq += 1;
  return {
    id: `e${eventSeq}`,
    type,
    sessionId: "s",
    createdAt: new Date(1_700_000_000_000 + eventSeq * 1000).toISOString(),
    payload,
  };
}

describe("agent transcript serialization", () => {
  it("round-trips a transcript losslessly", () => {
    const messages = [user("hi"), assistant([{ type: "text", text: "hello" }])];
    const restored = deserializeAgentTranscript(
      serializeAgentTranscript(messages),
    );
    expect(restored).toEqual(messages);
  });

  it("returns an empty transcript for malformed input", () => {
    expect(deserializeAgentTranscript("not json")).toEqual([]);
    expect(deserializeAgentTranscript("")).toEqual([]);
    expect(deserializeAgentTranscript("{}")).toEqual([]);
  });
});

describe("prepareTranscriptForResume — tool-call integrity", () => {
  it("leaves a well-formed transcript unchanged", () => {
    const messages = [
      user("read the file"),
      assistant([
        { type: "text", text: "Reading." },
        {
          type: "toolCall",
          id: "call-1",
          name: "read_file",
          arguments: { path: "a" },
        },
      ]),
      toolResult("call-1", "contents"),
      assistant([{ type: "text", text: "Done." }]),
    ];
    expect(prepareTranscriptForResume(messages)).toEqual(messages);
  });

  it("strips a dangling toolCall but keeps the assistant's text", () => {
    const messages = [
      user("read the file"),
      assistant([
        { type: "text", text: "Reading." },
        {
          type: "toolCall",
          id: "call-1",
          name: "read_file",
          arguments: { path: "a" },
        },
      ]),
      // No toolResult — app was killed mid-execution.
    ];
    const repaired = prepareTranscriptForResume(messages);
    expect(roles(repaired)).toEqual(["user", "assistant"]);
    const last = repaired[1] as { content: Array<{ type: string }> };
    expect(last.content).toEqual([{ type: "text", text: "Reading." }]);
  });

  it("drops an assistant message that is only a dangling toolCall", () => {
    const messages = [
      user("read the file"),
      assistant([
        {
          type: "toolCall",
          id: "call-1",
          name: "read_file",
          arguments: { path: "a" },
        },
      ]),
    ];
    expect(roles(prepareTranscriptForResume(messages))).toEqual(["user"]);
  });

  it("removes an orphan toolResult with no matching toolCall", () => {
    const messages = [
      user("hi"),
      assistant([{ type: "text", text: "hello" }]),
      toolResult("call-ghost", "contents"),
    ];
    expect(roles(prepareTranscriptForResume(messages))).toEqual([
      "user",
      "assistant",
    ]);
  });
});

describe("eventsToAgentMessages — reconstruct transcript from event log", () => {
  it("rebuilds a user/assistant exchange", () => {
    const messages = eventsToAgentMessages([
      ev(PI_SESSION_EVENT.Input, { text: "hi" }),
      ev(PI_SESSION_EVENT.OutputText, { text: "hello" }),
    ]);
    expect(roles(messages)).toEqual(["user", "assistant"]);
    expect((messages[0] as { content: unknown }).content).toBe("hi");
    expect((messages[1] as { content: unknown }).content).toEqual([
      { type: "text", text: "hello" },
    ]);
  });

  it("pairs a tool call with its result, in order, in one turn", () => {
    const messages = eventsToAgentMessages([
      ev(PI_SESSION_EVENT.Input, { text: "read a" }),
      ev(PI_SESSION_EVENT.OutputText, { text: "Reading." }),
      ev(PI_SESSION_EVENT.ToolStart, {
        toolName: "read_file",
        toolCallId: "c1",
        input: { path: "a" },
      }),
      ev(PI_SESSION_EVENT.ToolResult, {
        toolName: "read_file",
        toolCallId: "c1",
        output: { content: "data" },
        isError: false,
      }),
      ev(PI_SESSION_EVENT.OutputText, { text: "Done." }),
    ]);

    expect(roles(messages)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect((messages[1] as { content: unknown }).content).toEqual([
      { type: "text", text: "Reading." },
      {
        type: "toolCall",
        id: "c1",
        name: "read_file",
        arguments: { path: "a" },
      },
    ]);
    expect((messages[2] as { toolCallId: string }).toolCallId).toBe("c1");
    expect((messages[2] as { content: unknown }).content).toEqual([
      { type: "text", text: "data" },
    ]);
    expect((messages[3] as { content: unknown }).content).toEqual([
      { type: "text", text: "Done." },
    ]);
  });

  it("ignores reasoning, status, and usage events", () => {
    const messages = eventsToAgentMessages([
      ev(PI_SESSION_EVENT.Input, { text: "hi" }),
      ev(PI_SESSION_EVENT.ReasoningText, { text: "thinking" }),
      ev(PI_SESSION_EVENT.Status, { status: "running" }),
      ev(PI_SESSION_EVENT.OutputText, { text: "hello" }),
      ev(PI_SESSION_EVENT.Usage, { inputTokens: 1, outputTokens: 1 }),
    ]);
    expect(roles(messages)).toEqual(["user", "assistant"]);
  });
});
