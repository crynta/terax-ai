/**
 * `ChatTransport<UIMessage>` adapter that drives an external ACP agent
 * (Claude Code, Codex, Gemini) instead of a model API.
 *
 * For each Terax chat session we maintain ONE long-lived ACP session. The
 * transport's `sendMessages` extracts the most recent user-text-part and
 * forwards it to the agent via `agent_session_prompt`. While the agent is
 * working it streams `SessionUpdate` notifications (text, reasoning, tool
 * calls, plans) which we re-emit as `UIMessageChunk`s on a `ReadableStream`
 * the AI SDK can consume.
 *
 * Phase 1 covers the streaming text path and the tool-call lifecycle. The
 * permission-request → existing approval UI bridge lands in Phase 2 when
 * we add the Claude Code backend end-to-end.
 */

import type { UIMessage } from "@ai-sdk/react";
import type { ChatTransport } from "ai";

import {
  newQueuedEditId,
  usePlanStore,
} from "../store/planStore";
import {
  cancelTurn,
  closeSession,
  respondToPermission,
  sendPrompt,
  startSession,
} from "./client";
import {
  normalizeToolCall,
  normalizeToolCallContent,
  type AgentEvent,
  type ToolCallContentPart,
} from "./types";

type UIMessageChunk = Parameters<
  NonNullable<ReadableStreamDefaultController<unknown>["enqueue"]>
>[0]; // Loosened: we trust the typing on the call sites below.

type Deps = {
  /** Backend id ("claude-code" / "codex" / "gemini") to spawn against. */
  getBackendId: () => string;
  /** Workspace root or active terminal cwd. */
  getCwd: () => string | null;
};

/**
 * Per-Terax-session state. The ACP session is started lazily on the first
 * `sendMessages` because the chat may exist long before the user submits.
 */
type SessionState = {
  acpSessionId: string | null;
  /** Current open stream's controller; null between turns. */
  controller: ReadableStreamDefaultController<UIMessageChunk> | null;
  /** Allocated text-block id for the current assistant turn (one per turn). */
  currentTextId: string | null;
  /** Allocated reasoning-block id for the current turn. */
  currentReasoningId: string | null;
  /** AbortSignal listener, so cancel propagates. */
  abortListener: (() => void) | null;
  /** Tool-call ids we've already announced text-input-start for. */
  startedToolCalls: Set<string>;
  /**
   * Diffs we've already pushed into `planStore`, keyed by `${toolCallId}:${path}`.
   * ACP can emit the same diff in `tool_call` and again in successive
   * `tool_call_update`s — we only want to queue once per (call, path) pair.
   */
  enqueuedDiffs: Set<string>;
  dispose: (() => void) | null;
};

const sessionState = new Map<string, SessionState>();

/**
 * Cross-session bookkeeping for permission requests we've forwarded to the
 * UI but haven't yet answered. Keyed by the ACP `request_id` (which the
 * transport reuses verbatim as the AI SDK's `approvalId`). When the user
 * clicks Accept/Deny on the AiToolApproval card, the AgentRunBridge calls
 * `submitAcpApproval(approvalId, approved)` which finds the matching ACP
 * session here and forwards a `RequestPermissionResponse`.
 */
type PendingApproval = {
  acpSessionId: string;
  optionIds: string[];
};
const pendingApprovals = new Map<string, PendingApproval>();

function getOrInitState(chatId: string): SessionState {
  let s = sessionState.get(chatId);
  if (!s) {
    s = {
      acpSessionId: null,
      controller: null,
      currentTextId: null,
      currentReasoningId: null,
      abortListener: null,
      startedToolCalls: new Set(),
      enqueuedDiffs: new Set(),
      dispose: null,
    };
    sessionState.set(chatId, s);
  }
  return s;
}

/**
 * Forward a user's approve/deny click to the running ACP agent.
 *
 * Returns true when this approvalId belonged to an ACP session and we
 * dispatched a response — false if it was for the regular Vercel-AI-SDK
 * tool-approval flow (in which case the caller's existing
 * `addToolApprovalResponse` path is the only thing that needs to fire).
 */
export function submitAcpApproval(
  approvalId: string,
  approved: boolean,
): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  pendingApprovals.delete(approvalId);
  void respondToPermission({
    sessionId: pending.acpSessionId,
    requestId: approvalId,
    optionId: approved ? (pending.optionIds[0] ?? null) : null,
    cancelled: !approved,
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[agents-acp] respondToPermission failed:", e);
  });
  return true;
}

export function disposeAcpChatSession(chatId: string): void {
  const s = sessionState.get(chatId);
  if (!s) return;
  s.controller?.close();
  s.dispose?.();
  if (s.acpSessionId) {
    void closeSession(s.acpSessionId).catch(() => {});
  }
  sessionState.delete(chatId);
}

/**
 * Pull the user's text-input out of the last user message. The AI SDK puts
 * the input as a `parts` array — we concatenate `text` parts. Anything else
 * (image attachments, etc.) is dropped on the floor for Phase 1; the agents
 * we target don't accept image input over ACP yet either.
 */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const text = m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .filter(Boolean)
      .join("\n");
    if (text.trim().length > 0) return text;
  }
  return "";
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createAcpTransport(deps: Deps): ChatTransport<UIMessage> {
  return {
    async sendMessages(options): Promise<ReadableStream<UIMessageChunk>> {
      const chatId = options.chatId;
      const state = getOrInitState(chatId);

      // Lazily spawn the agent on first turn.
      if (!state.acpSessionId) {
        const onEvent = (ev: AgentEvent) => routeEvent(state, ev);
        const { sessionId, dispose } = await startSession({
          backendId: deps.getBackendId(),
          cwd: deps.getCwd(),
          onEvent,
        });
        state.acpSessionId = sessionId;
        state.dispose = dispose;
      }

      const userText = lastUserText(options.messages);

      const stream = new ReadableStream<UIMessageChunk>({
        start(controller) {
          state.controller = controller;
          state.currentTextId = null;
          state.currentReasoningId = null;
          state.startedToolCalls = new Set();
          state.enqueuedDiffs = new Set();

          // Wire abort: when the AI SDK aborts mid-turn, send `session/cancel`.
          if (options.abortSignal) {
            const onAbort = () => {
              if (state.acpSessionId) void cancelTurn(state.acpSessionId);
            };
            options.abortSignal.addEventListener("abort", onAbort);
            state.abortListener = () =>
              options.abortSignal?.removeEventListener("abort", onAbort);
          }
        },
        cancel() {
          if (state.acpSessionId) void cancelTurn(state.acpSessionId);
        },
      });

      // Kick off the prompt. If the user only attached non-text parts, send
      // a single space — agents like Claude Code reject empty prompts.
      const prompt = userText.length > 0 ? userText : " ";
      sendPrompt(state.acpSessionId!, prompt).catch((err) => {
        const ctrl = state.controller;
        if (!ctrl) return;
        try {
          ctrl.enqueue(makeError(err));
          ctrl.close();
        } catch {
          /* already closed */
        }
        state.controller = null;
      });

      return stream;
    },

    async reconnectToStream() {
      // ACP doesn't support cross-process reconnect today. Returning null is
      // the documented "no resumable stream" sentinel for the AI SDK.
      return null;
    },
  } as ChatTransport<UIMessage>;
}

// ---------- Event → chunk translation ----------

function routeEvent(state: SessionState, ev: AgentEvent): void {
  const ctrl = state.controller;
  if (!ctrl) return;

  switch (ev.type) {
    case "session_ready":
    case "plan":
      // Phase 1: not surfaced as chunks yet — only the structured side
      // channel. Future: emit plan as a custom data-part.
      break;

    case "assistant_chunk": {
      if (!state.currentTextId) {
        const id = newId("text");
        state.currentTextId = id;
        ctrl.enqueue({ type: "text-start", id });
      }
      ctrl.enqueue({
        type: "text-delta",
        id: state.currentTextId,
        delta: ev.text,
      });
      break;
    }

    case "reasoning_chunk": {
      if (!state.currentReasoningId) {
        const id = newId("reason");
        state.currentReasoningId = id;
        ctrl.enqueue({ type: "reasoning-start", id });
      }
      ctrl.enqueue({
        type: "reasoning-delta",
        id: state.currentReasoningId,
        delta: ev.text,
      });
      break;
    }

    case "tool_call": {
      const c = normalizeToolCall(ev.call);
      state.startedToolCalls.add(c.id);
      ctrl.enqueue({
        type: "tool-input-start",
        toolCallId: c.id,
        toolName: c.kind,
        title: c.title,
        dynamic: true,
      });
      ctrl.enqueue({
        type: "tool-input-available",
        toolCallId: c.id,
        toolName: c.kind,
        input: c.rawInput ?? null,
        title: c.title,
        dynamic: true,
      });
      enqueueDiffsFromContent(state, c.id, c.content);
      break;
    }

    case "tool_call_update": {
      // If we never saw a tool_call event for this id, synthesize the
      // input-start so the AI SDK doesn't drop the update.
      if (!state.startedToolCalls.has(ev.call_id)) {
        ctrl.enqueue({
          type: "tool-input-start",
          toolCallId: ev.call_id,
          toolName: ev.title ?? "tool",
          title: ev.title ?? undefined,
          dynamic: true,
        });
        state.startedToolCalls.add(ev.call_id);
      }
      // Surface a status update via tool-output-available with preliminary=true
      // so the UI can re-render. Final output goes on "completed" status.
      const finalStatus = ev.status === "completed" || ev.status === "failed";
      ctrl.enqueue({
        type: "tool-output-available",
        toolCallId: ev.call_id,
        output: {
          status: ev.status,
          content: ev.content,
          locations: ev.locations,
          rawOutput: ev.raw_output,
        },
        preliminary: !finalStatus,
        dynamic: true,
      });
      if (ev.content) {
        const normalized = ev.content.map(normalizeToolCallContent);
        enqueueDiffsFromContent(state, ev.call_id, normalized);
      }
      break;
    }

    case "permission_request":
      // Track the open ACP responder so the AgentRunBridge can resolve it
      // when the user picks Approve / Deny on the existing AiToolApproval
      // card. Phase 2 maps `approved=true → first allow option`,
      // `approved=false → cancelled`. A future iteration may surface the
      // full option list (allow-once / allow-always / reject-once / …).
      if (state.acpSessionId) {
        pendingApprovals.set(ev.request_id, {
          acpSessionId: state.acpSessionId,
          optionIds: ev.options.map((o) => o.id),
        });
      }
      ctrl.enqueue({
        type: "tool-approval-request",
        approvalId: ev.request_id,
        toolCallId: ev.tool_call.id,
      });
      break;

    case "turn_ended":
      finishOpenBlocks(state, ctrl);
      ctrl.close();
      state.controller = null;
      state.abortListener?.();
      state.abortListener = null;
      break;

    case "error":
      finishOpenBlocks(state, ctrl);
      ctrl.enqueue({ type: "error", errorText: ev.message });
      ctrl.close();
      state.controller = null;
      state.abortListener?.();
      state.abortListener = null;
      break;

    case "closed":
      finishOpenBlocks(state, ctrl);
      ctrl.close();
      state.controller = null;
      state.abortListener?.();
      state.abortListener = null;
      // ACP session is gone — purge our state so the next prompt re-spawns.
      state.acpSessionId = null;
      state.dispose = null;
      break;
  }
}

function finishOpenBlocks(
  state: SessionState,
  ctrl: ReadableStreamDefaultController<UIMessageChunk>,
) {
  if (state.currentTextId) {
    ctrl.enqueue({ type: "text-end", id: state.currentTextId });
    state.currentTextId = null;
  }
  if (state.currentReasoningId) {
    ctrl.enqueue({ type: "reasoning-end", id: state.currentReasoningId });
    state.currentReasoningId = null;
  }
}

function makeError(err: unknown): UIMessageChunk {
  return {
    type: "error",
    errorText: err instanceof Error ? err.message : String(err),
  };
}

/**
 * For each `Diff` content part on a tool call, push a `QueuedEdit` into
 * `planStore` so the existing `AiDiffPane` and Plan panel surface it.
 *
 * Phase 2 caveat: the agent itself may also write the file via its own
 * subprocess fs access (Claude Code does this rather than going through ACP
 * `fs/write_text_file`). The user's "Accept All" in the diff queue then
 * re-applies the same content via Terax's `native.writeFile`, which is a
 * no-op when contents already match. Future work: advertise our `fs`
 * capability and let the agent route writes through us instead.
 */
function enqueueDiffsFromContent(
  state: SessionState,
  toolCallId: string,
  parts: ToolCallContentPart[],
) {
  if (parts.length === 0) return;
  const enqueue = usePlanStore.getState().enqueue;
  for (const part of parts) {
    if (part.kind !== "diff") continue;
    const key = `${toolCallId}:${part.path}`;
    if (state.enqueuedDiffs.has(key)) continue;
    state.enqueuedDiffs.add(key);
    enqueue({
      id: newQueuedEditId(),
      kind: "write_file",
      path: part.path,
      originalContent: part.oldText ?? "",
      proposedContent: part.newText,
      isNewFile: part.oldText == null,
    });
  }
}
