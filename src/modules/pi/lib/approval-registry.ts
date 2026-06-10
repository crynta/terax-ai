/**
 * Registry of in-flight tool-approval requests for the webview Pi agent.
 *
 * Each entry holds the `resolve` of the promise the agent is awaiting before it
 * executes a tool. A user response resolves it with their decision; tearing the
 * session down (stop/delete) clears its pending approvals as denied so a late
 * response can't execute a tool after the fact.
 */
export type ApprovalResolver = (approved: boolean) => void;

export class PendingApprovalRegistry {
  private readonly pending = new Map<string, ApprovalResolver>();

  private key(sessionId: string, toolCallId: string): string {
    return `${sessionId}:${toolCallId}`;
  }

  /** Register a pending approval awaiting a user decision. */
  add(sessionId: string, toolCallId: string, resolve: ApprovalResolver): void {
    this.pending.set(this.key(sessionId, toolCallId), resolve);
  }

  /** Whether an approval is still pending for this call. */
  has(sessionId: string, toolCallId: string): boolean {
    return this.pending.has(this.key(sessionId, toolCallId));
  }

  /**
   * Resolve a pending approval with the user's decision. Returns false if no
   * approval was pending (e.g. already resolved, expired, or cleared).
   */
  respond(sessionId: string, toolCallId: string, approved: boolean): boolean {
    const key = this.key(sessionId, toolCallId);
    const resolve = this.pending.get(key);
    if (!resolve) return false;
    this.pending.delete(key);
    resolve(approved);
    return true;
  }

  /** Deny and remove every pending approval for a session. */
  clearForSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const [key, resolve] of this.pending) {
      if (key.startsWith(prefix)) {
        this.pending.delete(key);
        resolve(false);
      }
    }
  }
}
