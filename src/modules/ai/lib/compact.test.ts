import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { compactModelMessages, compactModelMessagesDetailed } from "./compact";

const BIG = "x".repeat(2000);

function readCall(id: string, path: string): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: "read_file",
        input: { path },
      },
    ],
  } as unknown as ModelMessage;
}

function readResult(id: string, value: string): ModelMessage {
  return {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: id, output: { type: "text", value } },
    ],
  } as unknown as ModelMessage;
}

function writeCall(id: string, path: string): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: "write_file",
        input: { path },
      },
    ],
  } as unknown as ModelMessage;
}

function outputOf(message: ModelMessage): { __elided?: boolean } {
  const parts = message.content as Array<{ output?: { __elided?: boolean } }>;
  return parts[0].output ?? {};
}

function isElided(message: ModelMessage): boolean {
  return outputOf(message).__elided === true;
}

describe("compactModelMessagesDetailed", () => {
  it("returns the input untouched when it fits the context budget", () => {
    const messages = [{ role: "user", content: "hi" }] as ModelMessage[];
    const result = compactModelMessagesDetailed(messages, 1000);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("elides a read result once its file has been written", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", BIG),
      writeCall("c2", "/a.txt"),
      { role: "user", content: BIG } as ModelMessage,
    ];
    const result = compactModelMessagesDetailed(messages, 1000);
    expect(result.compacted).toBe(true);
    expect(isElided(result.messages[1])).toBe(true);
  });

  it("keeps the latest read of a path and elides the superseded one", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", BIG),
      readCall("c2", "/a.txt"),
      readResult("c2", BIG),
      { role: "user", content: BIG } as ModelMessage,
    ];
    const result = compactModelMessagesDetailed(messages, 1000);
    expect(isElided(result.messages[1])).toBe(true);
    expect(isElided(result.messages[3])).toBe(false);
  });

  it("does not elide superseded reads while under the budget", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", "tiny"),
      readCall("c2", "/a.txt"),
      readResult("c2", "tiny"),
    ];
    const result = compactModelMessagesDetailed(messages, 100_000);
    expect(result.compacted).toBe(false);
    expect(isElided(result.messages[1])).toBe(false);
  });

  it("is idempotent: re-running does not re-elide an already-elided result", () => {
    const messages = [
      readCall("c1", "/a.txt"),
      readResult("c1", BIG),
      writeCall("c2", "/a.txt"),
      { role: "user", content: BIG } as ModelMessage,
    ];
    const once = compactModelMessagesDetailed(messages, 1000);
    const twice = compactModelMessagesDetailed(once.messages, 1000);
    expect(twice.compacted).toBe(false);
    expect(isElided(twice.messages[1])).toBe(true);
  });
});

describe("compactModelMessages", () => {
  it("returns the messages array from the detailed result", () => {
    const messages = [{ role: "user", content: "hi" }] as ModelMessage[];
    expect(compactModelMessages(messages, 1000)).toBe(messages);
  });
});
