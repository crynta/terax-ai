import { describe, expect, it } from "vitest";
import {
  denyPendingToolApprovals,
  FOLLOW_UP_DENY_REASON,
  listPendingApprovalIds,
  type MessageLike,
} from "./denyPendingApprovals";

function assistantWith(
  parts: MessageLike["parts"],
): MessageLike {
  return { role: "assistant", parts };
}

describe("denyPendingToolApprovals", () => {
  it("returns 0 and leaves messages alone when nothing is pending", () => {
    const messages: MessageLike[] = [
      { role: "user", parts: [{ type: "text", text: "hi" }] },
      assistantWith([
        { type: "text", text: "done" },
        {
          type: "tool-bash_run",
          state: "output-available",
          approval: { id: "a1", approved: true },
        },
      ]),
    ];
    expect(denyPendingToolApprovals(messages)).toBe(0);
    expect(messages[1].parts[1].state).toBe("output-available");
  });

  it("rewrites approval-requested parts to output-denied", () => {
    const messages: MessageLike[] = [
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
    expect(part.state).toBe("output-denied");
    expect(part.approval).toEqual({
      id: "appr-1",
      approved: false,
      reason: FOLLOW_UP_DENY_REASON,
    });
    expect(part.input).toEqual({ command: "rm -rf /" });
    expect(messages[0].parts[1].state).toBeUndefined();
  });

  it("denies every pending approval across assistant messages", () => {
    const messages: MessageLike[] = [
      assistantWith([
        {
          type: "tool-write_file",
          state: "approval-requested",
          approval: { id: "w1" },
        },
      ]),
      { role: "user", parts: [{ type: "text", text: "earlier" }] },
      assistantWith([
        {
          type: "tool-bash_run",
          state: "approval-requested",
          approval: { id: "b1" },
        },
        {
          type: "tool-edit",
          state: "approval-requested",
          approval: { id: "e1" },
        },
      ]),
    ];
    expect(denyPendingToolApprovals(messages)).toBe(3);
    expect(listPendingApprovalIds(messages)).toEqual([]);
    expect(messages[0].parts[0].state).toBe("output-denied");
    expect(messages[2].parts.map((p) => p.state)).toEqual([
      "output-denied",
      "output-denied",
    ]);
  });

  it("uses a fallback id when approval.id is missing", () => {
    const messages: MessageLike[] = [
      assistantWith([{ type: "tool-x", state: "approval-requested" }]),
    ];
    denyPendingToolApprovals(messages);
    expect(messages[0].parts[0].approval?.id).toBe("unknown");
  });
});

describe("listPendingApprovalIds", () => {
  it("collects only approval-requested ids", () => {
    const messages: MessageLike[] = [
      assistantWith([
        { state: "approval-requested", approval: { id: "a" } },
        { state: "output-denied", approval: { id: "b" } },
        { state: "approval-requested", approval: { id: "c" } },
      ]),
    ];
    expect(listPendingApprovalIds(messages)).toEqual(["a", "c"]);
  });
});
