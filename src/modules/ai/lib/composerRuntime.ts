/**
 * Composer runtime seam (Phase C, Stage 2).
 *
 * The docked quick-ask composer used to call `chatStore` directly to send and
 * stop a turn. That hard-wired it to the legacy AI-SDK runtime. This module
 * lifts the send/stop/active-session path behind a `ComposerRuntime` interface
 * so the composer depends on a contract, not a runtime. Today there is one
 * implementation (chat) and it is the default, so behavior is unchanged; adding
 * a pi-backed implementation becomes "write a second `ComposerRuntime` and
 * select it by flag" rather than surgery inside the composer.
 */
import { useMemo } from "react";
import { getOrCreateChat, useChatStore } from "../store/chatStore";

/** A single outbound message part the composer assembles before sending. */
export type ComposerMessagePart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; url: string; filename?: string };

export type ComposerRuntime = {
  /** Active conversation id, or null when there is nothing to send to. */
  readonly sessionId: string | null;
  /** Send a user turn. Implementations own their post-send side effects. */
  send: (parts: ComposerMessagePart[]) => void;
  /** Cancel the in-flight turn, if any. */
  stop: () => void;
};

/**
 * The legacy chat-backed runtime: sends through the active `chatStore` chat and
 * opens the mini window. This preserves the exact pre-seam behavior.
 */
export function useChatComposerRuntime(): ComposerRuntime {
  const sessionId = useChatStore((s) => s.activeSessionId);

  return useMemo<ComposerRuntime>(
    () => ({
      sessionId,
      send: (parts) => {
        if (!sessionId) return;
        const chat = getOrCreateChat(sessionId);
        void chat.sendMessage({ role: "user", parts } as Parameters<
          typeof chat.sendMessage
        >[0]);
        const store = useChatStore.getState();
        store.patchAgentMeta({ hitStepCap: false, compactionNotice: null });
        if (!store.mini.open) store.openMini();
      },
      stop: () => {
        if (!sessionId) return;
        void getOrCreateChat(sessionId).stop();
      },
    }),
    [sessionId],
  );
}

/**
 * Resolve the active composer runtime. Single implementation today; this is the
 * one place a pi-backed runtime gets selected (by flag) in the Stage 2 follow-up,
 * so the composer itself never needs to change again.
 */
export function useComposerRuntime(): ComposerRuntime {
  return useChatComposerRuntime();
}
