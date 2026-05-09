import { useChat, type UIMessage } from "@ai-sdk/react";
import type { ToolUIPart, UIMessagePart } from "ai";
import { useEffect, useMemo, useRef } from "react";
import type { AiDiffStatus } from "@/modules/tabs";
import { native } from "../lib/native";
import { checkReadable } from "../lib/security";
import { resolvePath } from "../tools/tools";
import {
  flushPersist,
  getOrCreateChat,
  useChatStore,
  type AgentRunStatus,
} from "../store/chatStore";

/**
 * Headless bridge that mirrors chat lifecycle into the store, so the status
 * pill / mini-window / panel can react without being inside the chat hook tree.
 *
 * Side effects:
 *  - Patches `agentMeta` on every status / approvals change.
 *  - Auto-opens the mini-window when an approval is pending — the user has
 *    to act on it; hiding it would be hostile.
 *  - For pending `write_file` calls, opens an AI diff tab in the editor area
 *    so the user can review the proposed change before approving.
 *  - Persists messages of the active session on every change.
 */

type DiffOpenInput = {
  path: string;
  originalContent: string;
  proposedContent: string;
  approvalId: string;
  isNewFile: boolean;
};

type Props = {
  openAiDiffTab: (input: DiffOpenInput) => number | null;
  setAiDiffStatus: (approvalId: string, status: AiDiffStatus) => void;
};

export function AgentRunBridge(props: Props) {
  const sessionId = useChatStore((s) => s.activeSessionId);
  if (!sessionId) return null;
  return <Bridge sessionId={sessionId} {...props} />;
}

type WriteFileInput = { path?: unknown; content?: unknown };

type ToolPartLike = ToolUIPart & {
  approval?: { id: string };
  input?: WriteFileInput;
};

type AnyPart = UIMessagePart<Record<string, never>, Record<string, never>>;

function Bridge({
  sessionId,
  openAiDiffTab,
  setAiDiffStatus,
}: { sessionId: string } & Props) {
  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const { status, messages, addToolApprovalResponse } = useChat<UIMessage>({
    chat,
  });
  const patch = useChatStore((s) => s.patchAgentMeta);
  const openMini = useChatStore((s) => s.openMini);
  const persistMessages = useChatStore((s) => s.persistMessages);
  const setApprovalResponder = useChatStore((s) => s.setApprovalResponder);

  // Expose the approval responder so the diff tab can resolve approvals.
  // We keep it in a ref-stable closure so identity is stable per render.
  useEffect(() => {
    setApprovalResponder((id, approved) =>
      addToolApprovalResponse({ id, approved }),
    );
    return () => setApprovalResponder(null);
  }, [setApprovalResponder, addToolApprovalResponse]);

  useEffect(() => {
    persistMessages(sessionId, messages);
  }, [sessionId, messages, persistMessages]);

  // Flush the debounced write whenever the chat goes idle (or errors),
  // and on unmount, so a closed app or session-switch never loses the tail.
  useEffect(() => {
    if (status !== "submitted" && status !== "streaming") {
      flushPersist(sessionId);
    }
  }, [sessionId, status]);
  useEffect(() => {
    return () => flushPersist(sessionId);
  }, [sessionId]);

  const approvalsPending = useMemo(() => {
    let n = 0;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const p of m.parts) {
        if ((p as { state?: string }).state === "approval-requested") n++;
      }
    }
    return n;
  }, [messages]);

  useEffect(() => {
    let runStatus: AgentRunStatus;
    if (approvalsPending > 0) runStatus = "awaiting-approval";
    else if (status === "submitted") runStatus = "thinking";
    else if (status === "streaming") runStatus = "streaming";
    else if (status === "error") runStatus = "error";
    else runStatus = "idle";
    patch({
      status: runStatus,
      approvalsPending,
      ...(runStatus === "idle" || runStatus === "error" ? { step: null } : {}),
      ...(runStatus === "idle" ? { error: null } : {}),
    });
  }, [status, approvalsPending, patch]);

  useEffect(() => {
    if (approvalsPending > 0) openMini();
  }, [approvalsPending, openMini]);

  // ---- AI diff tab management ----------------------------------------------
  // We track which approvalIds have already opened a tab so re-renders don't
  // open duplicates. Reset when the session changes.
  const openedRef = useRef<Set<string>>(new Set());
  const fileMutationFingerprintRef = useRef<string>("");
  useEffect(() => {
    openedRef.current = new Set();
    fileMutationFingerprintRef.current = "";
  }, [sessionId]);

  // Cheap fingerprint of file-mutation tool parts only. The diff-tab effect
  // is the most expensive thing on the streaming path, so we skip it when
  // only text/reasoning tokens have arrived (the common case).
  const fileMutationFingerprint = useMemo(() => {
    let fp = "";
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const p of m.parts as AnyPart[]) {
        const t = (p as { type?: string }).type;
        if (
          t === "tool-write_file" ||
          t === "tool-edit" ||
          t === "tool-multi_edit"
        ) {
          const state = (p as { state?: string }).state ?? "";
          const id = (p as { approval?: { id?: string } }).approval?.id ?? "";
          fp += `${id}:${state}|`;
        }
      }
    }
    return fp;
  }, [messages]);

  useEffect(() => {
    type Pending = {
      approvalId: string;
      path: string;
      /**
       * Either a literal proposed content (write_file), or a function that
       * derives proposed content from the on-disk original (edit/multi_edit).
       */
      derive:
        | { kind: "literal"; content: string }
        | { kind: "edits"; edits: EditOp[] };
    };
    type StatusUpdate = { approvalId: string; status: AiDiffStatus };

    if (fileMutationFingerprint === fileMutationFingerprintRef.current) {
      return;
    }
    fileMutationFingerprintRef.current = fileMutationFingerprint;

    const pending: Pending[] = [];
    const statusUpdates: StatusUpdate[] = [];

    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of m.parts as AnyPart[]) {
        const info = extractFileMutation(part);
        if (!info) continue;
        const { state, approvalId, path, derive } = info;
        if (!approvalId) continue;
        if (state === "approval-requested") {
          if (!openedRef.current.has(approvalId)) {
            pending.push({ approvalId, path, derive });
          }
        } else if (state === "approval-responded") {
          // Response may carry an `approved` bit; if not present, leave the
          // tab in pending — the next state transition (output-* below) will
          // settle it.
          const approved = (part as { approval?: { approved?: boolean } })
            .approval?.approved;
          if (typeof approved === "boolean") {
            statusUpdates.push({
              approvalId,
              status: approved ? "approved" : "rejected",
            });
          }
        } else if (state === "output-available") {
          statusUpdates.push({ approvalId, status: "approved" });
        } else if (state === "output-error") {
          statusUpdates.push({ approvalId, status: "rejected" });
        }
      }
    }

    for (const u of statusUpdates) setAiDiffStatus(u.approvalId, u.status);

    if (pending.length === 0) return;

    let cancelled = false;
    void (async () => {
      const cwd = useChatStore.getState().live.getCwd();
      for (const p of pending) {
        if (cancelled) return;
        // Mark as opened up-front so a re-render mid-await doesn't double-open.
        openedRef.current.add(p.approvalId);
        let abs: string;
        try {
          abs = resolvePath(p.path, cwd);
        } catch {
          abs = p.path;
        }
        const original = await readOriginal(abs);
        if (cancelled) return;
        let proposed = "";
        if (p.derive.kind === "literal") {
          proposed = p.derive.content;
        } else {
          const r = applyEditsLocally(original.content, p.derive.edits);
          if (!r.ok) {
            // Edit precondition failed (string not found / not unique).
            // Skip opening the tab; the approval modal will surface the error.
            continue;
          }
          proposed = r.content;
        }
        openAiDiffTab({
          path: abs,
          originalContent: original.content,
          proposedContent: proposed,
          approvalId: p.approvalId,
          isNewFile: original.isNewFile,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, fileMutationFingerprint, openAiDiffTab, setAiDiffStatus]);

  return null;
}

type EditOp = { old_string: string; new_string: string; replace_all?: boolean };

type FileMutation =
  | {
      state: string;
      approvalId: string | null;
      path: string;
      derive: { kind: "literal"; content: string };
    }
  | {
      state: string;
      approvalId: string | null;
      path: string;
      derive: { kind: "edits"; edits: EditOp[] };
    };

function extractFileMutation(part: AnyPart): FileMutation | null {
  const type = (part as { type?: string }).type;
  const p = part as ToolPartLike;
  const state = (p as { state?: string }).state ?? "";
  const approvalId = p.approval?.id ?? null;

  if (type === "tool-write_file") {
    const input = (p.input ?? {}) as WriteFileInput;
    const path = typeof input.path === "string" ? input.path : "";
    const content = typeof input.content === "string" ? input.content : "";
    if (!path) return null;
    return { state, approvalId, path, derive: { kind: "literal", content } };
  }
  if (type === "tool-edit") {
    const input = (p.input ?? {}) as {
      path?: unknown;
      old_string?: unknown;
      new_string?: unknown;
      replace_all?: unknown;
    };
    const path = typeof input.path === "string" ? input.path : "";
    const oldStr = typeof input.old_string === "string" ? input.old_string : "";
    const newStr = typeof input.new_string === "string" ? input.new_string : "";
    if (!path) return null;
    return {
      state,
      approvalId,
      path,
      derive: {
        kind: "edits",
        edits: [
          {
            old_string: oldStr,
            new_string: newStr,
            replace_all: Boolean(input.replace_all),
          },
        ],
      },
    };
  }
  if (type === "tool-multi_edit") {
    const input = (p.input ?? {}) as { path?: unknown; edits?: unknown };
    const path = typeof input.path === "string" ? input.path : "";
    if (!path || !Array.isArray(input.edits)) return null;
    const edits: EditOp[] = (input.edits as Record<string, unknown>[])
      .map((e) => ({
        old_string: typeof e.old_string === "string" ? e.old_string : "",
        new_string: typeof e.new_string === "string" ? e.new_string : "",
        replace_all: Boolean(e.replace_all),
      }))
      .filter((e) => e.old_string.length > 0);
    if (edits.length === 0) return null;
    return { state, approvalId, path, derive: { kind: "edits", edits } };
  }
  return null;
}

function applyEditsLocally(
  original: string,
  edits: EditOp[],
): { ok: true; content: string } | { ok: false } {
  let content = original;
  for (const e of edits) {
    if (e.old_string === e.new_string || e.old_string.length === 0)
      return { ok: false };
    if (e.replace_all) {
      if (!content.includes(e.old_string)) return { ok: false };
      content = content.split(e.old_string).join(e.new_string);
    } else {
      const first = content.indexOf(e.old_string);
      if (first === -1) return { ok: false };
      const second = content.indexOf(e.old_string, first + 1);
      if (second !== -1) return { ok: false };
      content =
        content.slice(0, first) +
        e.new_string +
        content.slice(first + e.old_string.length);
    }
  }
  return { ok: true, content };
}

async function readOriginal(
  abs: string,
): Promise<{ content: string; isNewFile: boolean }> {
  // The fs guard rejects sensitive paths even on read; mirror that here so
  // the user sees an empty "before" rather than an error tab.
  const safety = checkReadable(abs);
  if (!safety.ok) return { content: "", isNewFile: false };
  try {
    const r = await native.readFile(abs);
    if (r.kind === "text") return { content: r.content, isNewFile: false };
    // Binary or oversized — we can't render the original sensibly. Show the
    // proposed content as a "new" view; the user can still cancel.
    return { content: "", isNewFile: false };
  } catch (e) {
    const msg = String(e).toLowerCase();
    const notFound =
      msg.includes("no such file") ||
      msg.includes("not found") ||
      msg.includes("os error 2");
    return { content: "", isNewFile: notFound };
  }
}
