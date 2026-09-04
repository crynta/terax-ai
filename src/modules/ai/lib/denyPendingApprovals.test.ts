import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  denyPendingToolApprovals,
  FOLLOW_UP_DENY_REASON,
  listPendingApprovalIds,
} from "./denyPendingApprovals";

function assistantWith(
  parts: UIMessage["parts"],
): UIMessage {
  return { id: "a1", role: "assistant", parts };
}

describe("denyPendingToolApprovals", () => {
  it("returns 0 and leaves messages alone when nothing is pending", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      assistantWith([
        { type: "text", text: "done" },
        {
          type: "tool-bash_run",
          toolCallId: "c0",
          state: "output-available",
          input: { command: "echo hi" },
          output: "hi",
          approval: { id: "a1", approved: true },
        },
      ]),
    ];
    expect(denyPendingToolApprovals(messages)).toBe(0);
    const tool = messages[1].parts[1];
    expect(tool).toMatchObject({ state: "output-available" });
  });

  it("rewrites approval-requested parts to output-denied", () => {
    const messages: UIMessage[] = [
      assistantWith([
        {
          type: "tool-bash_run",
          toolCallId: "c1",
          state: "approval-requested",
          approval: { id: "appr-1" },
          input: { command: "rm -rf /" },
        },
        { type: "text", text: "may I?" },
      ]),
    ];
    expect(denyPendingToolApprovals(messages)).toBe(1);
    const part = messages[0].parts[0];
    expect(part).toMatchObject({
      state: "output-denied",
      toolCallId: "c1",
      input: { command: "rm -rf /" },
      approval: {
        id: "appr-1",
        approved: false,
        reason: FOLLOW_UP_DENY_REASON,
      },
    });
    expect(messages[0].parts[1]).toMatchObject({ type: "text" });
  });

  it("denies every pending approval across assistant messages", () => {
    const messages: UIMessage[] = [
      assistantWith([
        {
          type: "tool-write_file",
          toolCallId: "c-w",
          state: "approval-requested",
          approval: { id: "w1" },
          input: { path: "a.txt", content: "x" },
        },
      ]),
      { id: "u2", role: "user", parts: [{ type: "text", text: "earlier" }] },
      assistantWith([
        {
          type: "tool-bash_run",
          toolCallId: "c-b",
          state: "approval-requested",
          approval: { id: "b1" },
          input: { command: "ls" },
        },
        {
          type: "tool-edit",
          toolCallId: "c-e",
          state: "approval-requested",
          approval: { id: "e1" },
          input: { path: "b.ts", old: "a", new: "b" },
        },
      ]),
    ];
    expect(denyPendingToolApprovals(messages)).toBe(3);
    expect(listPendingApprovalIds(messages)).toEqual([]);
    expect(messages[0].parts[0]).toMatchObject({ state: "output-denied" });
    expect(messages[2].parts.map((p) => ("state" in p ? p.state : undefined))).toEqual([
      "output-denied",
      "output-denied",
    ]);
  });

  it("skips incomplete approval-requested parts (no invented approval id)", () => {
    const messages: UIMessage[] = [
      assistantWith([
        {
          type: "tool-x",
          toolCallId: "c-x",
          state: "approval-requested",
          input: {},
        } as UIMessage["parts"][number],
      ]),
    ];
    expect(denyPendingToolApprovals(messages)).toBe(0);
    expect(messages[0].parts[0]).toMatchObject({
      state: "approval-requested",
    });
    expect(
      "approval" in messages[0].parts[0]
        ? (messages[0].parts[0] as { approval?: { id?: string } }).approval?.id
        : undefined,
    ).toBeUndefined();
  });
});

describe("listPendingApprovalIds", () => {
  it("collects only approval-requested ids", () => {
    const messages: UIMessage[] = [
      assistantWith([
        {
          type: "tool-bash_run",
          toolCallId: "c1",
          state: "approval-requested",
          approval: { id: "a" },
          input: { command: "a" },
        },
        {
          type: "tool-bash_run",
          toolCallId: "c2",
          state: "output-denied",
          approval: { id: "b", approved: false, reason: "no" },
          input: { command: "b" },
        },
        {
          type: "tool-bash_run",
          toolCallId: "c3",
          state: "approval-requested",
          approval: { id: "c" },
          input: { command: "c" },
        },
      ]),
    ];
    expect(listPendingApprovalIds(messages)).toEqual(["a", "c"]);
  });
});
