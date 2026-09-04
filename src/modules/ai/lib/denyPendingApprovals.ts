/**
 * When the user sends a follow-up while tool approvals are still pending,
 * the AI SDK throws MissingToolResultsError because approval-requested parts
 * have no matching tool-result. Mutating those parts to output-denied (the
 * state convertToModelMessages already understands) lets the follow-up send
 * cleanly without racing sendAutomaticallyWhen via addToolApprovalResponse.
 *
 * See: https://github.com/crynta/terax-ai/issues/514
 */

import { isToolUIPart, type UIMessage } from "ai";

export const FOLLOW_UP_DENY_REASON = "Superseded by follow-up prompt";

function hasApprovalId(
  approval: unknown,
): approval is { id: string; approved?: boolean; reason?: string } {
  return (
    typeof approval === "object" &&
    approval !== null &&
    typeof (approval as { id?: unknown }).id === "string" &&
    (approval as { id: string }).id.length > 0
  );
}

/**
 * In-place: rewrite every valid approval-requested tool part to output-denied.
 * Only mutates AI SDK tool parts that already carry toolCallId, input, and
 * approval.id — incomplete parts are left alone so we never emit invalid
 * output-denied shapes. Returns the number of parts denied (0 if none pending).
 */
export function denyPendingToolApprovals(
  messages: UIMessage[],
  reason: string = FOLLOW_UP_DENY_REASON,
): number {
  let denied = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    m.parts = m.parts.map((part) => {
      if (!isToolUIPart(part)) return part;
      if (part.state !== "approval-requested") return part;
      if (!hasApprovalId(part.approval)) return part;
      if (typeof part.toolCallId !== "string" || part.toolCallId.length === 0) {
        return part;
      }
      if (!("input" in part) || part.input === undefined) return part;
      denied += 1;
      return {
        ...part,
        state: "output-denied" as const,
        approval: {
          id: part.approval.id,
          approved: false as const,
          reason,
        },
      };
    });
  }
  return denied;
}

/** Collect approval ids currently waiting on the user. */
export function listPendingApprovalIds(messages: UIMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const part of m.parts) {
      if (!isToolUIPart(part)) continue;
      if (part.state !== "approval-requested") continue;
      if (!hasApprovalId(part.approval)) continue;
      ids.push(part.approval.id);
    }
  }
  return ids;
}
