/**
 * When the user sends a follow-up while tool approvals are still pending,
 * the AI SDK throws MissingToolResultsError because approval-requested parts
 * have no matching tool-result. Mutating those parts to output-denied (the
 * state convertToModelMessages already understands) lets the follow-up send
 * cleanly without racing sendAutomaticallyWhen via addToolApprovalResponse.
 *
 * See: https://github.com/crynta/terax-ai/issues/514
 */

export type ApprovalPart = {
  state?: string;
  approval?: { id?: string; approved?: boolean; reason?: string };
  [key: string]: unknown;
};

export type MessageLike = {
  role: string;
  parts: ApprovalPart[];
};

export const FOLLOW_UP_DENY_REASON = "Superseded by follow-up prompt";

/**
 * In-place: rewrite every approval-requested tool part to output-denied.
 * Returns the number of parts denied (0 if none pending).
 */
export function denyPendingToolApprovals(
  messages: MessageLike[],
  reason: string = FOLLOW_UP_DENY_REASON,
): number {
  let denied = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    m.parts = m.parts.map((part) => {
      if (part.state !== "approval-requested") return part;
      denied += 1;
      return {
        ...part,
        state: "output-denied",
        approval: {
          id: part.approval?.id ?? "unknown",
          approved: false,
          reason,
        },
      };
    });
  }
  return denied;
}

/** Collect approval ids currently waiting on the user. */
export function listPendingApprovalIds(messages: MessageLike[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const part of m.parts) {
      if (part.state !== "approval-requested") continue;
      const id = part.approval?.id;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    }
  }
  return ids;
}
