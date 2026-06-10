/**
 * Tests for the pi-agent-core AgentEvent → PiSessionEvent translator.
 *
 * These lock two correctness properties that the inline emitter in
 * webview-session.ts got wrong:
 *
 *  #1 Multi-message turns: after a tool call the agent emits a NEW assistant
 *     message. Streamed text for that second message must NOT be dropped or
 *     garbled (the old emitter tracked text by content-block index across the
 *     whole turn, so the second message's index-0 text collided with the
 *     first message's longer text and produced empty deltas).
 *
 *  #2 Reasoning output: thinking deltas must be surfaced as reasoning events
 *     (the old emitter only looked at `block.type === "text"` and dropped
 *     thinking entirely, even though thinkingLevel was being sent).
 */

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createAgentEventTranslator } from "./agent-events";
import { PI_SESSION_EVENT, type PiSessionEvent } from "./types";

// Deterministic id/clock so assertions are stable.
function makeTranslator() {
  let counter = 0;
  return createAgentEventTranslator({
    sessionId: "sess-1",
    newId: () => `evt-${++counter}`,
    now: () => "2026-06-10T00:00:00.000Z",
  });
}

function textDelta(delta: string): AgentEvent {
  return {
    type: "message_update",
    message: { role: "assistant", content: [] },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
  } as unknown as AgentEvent;
}

function thinkingDelta(delta: string): AgentEvent {
  return {
    type: "message_update",
    message: { role: "assistant", content: [] },
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta },
  } as unknown as AgentEvent;
}

function messageEnd(
  content: Array<
    { type: "text"; text: string } | { type: "thinking"; thinking: string }
  >,
): AgentEvent {
  return {
    type: "message_end",
    message: { role: "assistant", content },
  } as unknown as AgentEvent;
}

function toolStart(
  toolName: string,
  toolCallId: string,
  args: unknown,
): AgentEvent {
  return {
    type: "tool_execution_start",
    toolName,
    toolCallId,
    args,
  } as AgentEvent;
}

function toolEnd(
  toolName: string,
  toolCallId: string,
  result: unknown,
  isError: boolean,
): AgentEvent {
  return {
    type: "tool_execution_end",
    toolName,
    toolCallId,
    result,
    isError,
  } as AgentEvent;
}

function payloadTexts(events: PiSessionEvent[], type: string): string[] {
  return events
    .filter((e) => e.type === type)
    .map((e) => e.payload.text as string);
}

describe("agent event translator", () => {
  it("keeps streamed text from a second assistant message after a tool call (#1)", () => {
    const translator = makeTranslator();
    const out: PiSessionEvent[] = [];
    const feed = (event: AgentEvent) =>
      out.push(...translator.translate(event));

    // First assistant message.
    feed(textDelta("Hello "));
    feed(textDelta("world."));
    feed(messageEnd([{ type: "text", text: "Hello world." }]));
    // A tool call interrupts the turn.
    feed(toolStart("read_file", "call-1", { path: "a.txt" }));
    feed(toolEnd("read_file", "call-1", "contents", false));
    // Second assistant message — must not be dropped.
    feed(textDelta("Done "));
    feed(textDelta("now."));
    feed(messageEnd([{ type: "text", text: "Done now." }]));

    // Every delta survives, in order — including the second message's.
    expect(payloadTexts(out, PI_SESSION_EVENT.OutputDelta)).toEqual([
      "Hello ",
      "world.",
      "Done ",
      "now.",
    ]);
    // Each message contributes its own final text — not a merged blob.
    expect(payloadTexts(out, PI_SESSION_EVENT.OutputText)).toEqual([
      "Hello world.",
      "Done now.",
    ]);
  });

  it("emits tool start and result events with the SDK payloads", () => {
    const translator = makeTranslator();
    const start = translator.translate(
      toolStart("bash_run", "call-9", { command: "ls" }),
    );
    const end = translator.translate(
      toolEnd("bash_run", "call-9", "file.txt", false),
    );

    expect(start).toHaveLength(1);
    expect(start[0].type).toBe(PI_SESSION_EVENT.ToolStart);
    expect(start[0].payload).toMatchObject({
      toolName: "bash_run",
      toolCallId: "call-9",
      input: { command: "ls" },
    });

    expect(end[0].type).toBe(PI_SESSION_EVENT.ToolResult);
    expect(end[0].payload).toMatchObject({
      toolName: "bash_run",
      toolCallId: "call-9",
      isError: false,
    });
  });

  it("surfaces reasoning deltas and final reasoning text (#2)", () => {
    const translator = makeTranslator();
    const out: PiSessionEvent[] = [];
    const feed = (event: AgentEvent) =>
      out.push(...translator.translate(event));

    feed(thinkingDelta("Let me "));
    feed(thinkingDelta("think."));
    feed(textDelta("The answer is 42."));
    feed(
      messageEnd([
        { type: "thinking", thinking: "Let me think." },
        { type: "text", text: "The answer is 42." },
      ]),
    );

    expect(payloadTexts(out, PI_SESSION_EVENT.ReasoningDelta)).toEqual([
      "Let me ",
      "think.",
    ]);
    expect(payloadTexts(out, PI_SESSION_EVENT.ReasoningText)).toEqual([
      "Let me think.",
    ]);
    // Reasoning does not leak into the visible output stream.
    expect(payloadTexts(out, PI_SESSION_EVENT.OutputDelta)).toEqual([
      "The answer is 42.",
    ]);
    expect(payloadTexts(out, PI_SESSION_EVENT.OutputText)).toEqual([
      "The answer is 42.",
    ]);
  });

  it("does not emit output/reasoning final events for an empty message", () => {
    const translator = makeTranslator();
    const out = translator.translate(messageEnd([]));
    expect(out).toEqual([]);
  });
});
