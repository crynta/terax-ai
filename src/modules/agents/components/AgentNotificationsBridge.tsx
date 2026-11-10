import { subscribeAgentEvents } from "@/modules/control/lib/agentEvents";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import {
  hasLeaf,
  leafIdForPty,
  subscribeAgentSignals,
  useAgentActivityStore,
} from "@/modules/terminal";
import { useEffect, useRef } from "react";
import { shouldOpenInChat } from "../lib/chatDefault";
import { displayAgent } from "../lib/format";
import { usePhaseReconciler } from "../lib/phaseReconciler";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import { claudeSessionOf } from "../lib/sessionLink";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { openReader } from "../reader/readerStore";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  tabs: Tab[];
  activeId: number;
  focused: boolean;
  onActivate: Activate;
};

function tabInfo(
  tabs: Tab[],
  leafId: number,
): { tabId: number; title: string } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && hasLeaf(t.paneTree, leafId)) {
      return { tabId: t.id, title: t.title };
    }
  }
  return null;
}

function route(
  session: AgentSession,
  kind: "attention" | "finished",
  ctx: Ctx,
): void {
  const info = tabInfo(ctx.tabs, session.leafId);
  const name = displayAgent(session.agent);
  const heading =
    kind === "attention" ? `${name} needs your input` : `${name} finished`;

  routeAgentNotification({
    source: "terminal",
    agent: session.agent,
    kind,
    title: heading,
    body: info?.title,
    focused: ctx.focused,
    visible: ctx.activeId === session.tabId,
    // Stop fires every turn, so finished only updates the bell; attention toasts.
    allowToast: kind === "attention",
    tabId: session.tabId,
    leafId: session.leafId,
    onActivate: () => ctx.onActivate(session.tabId, session.leafId),
  });
}

function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = tabInfo(ctx.tabs, leafId);
      if (!info) return;
      const tracked = store.sessions[leafId] !== undefined;
      store.start(leafId, info.tabId, sig.agent ?? "agent");
      if (
        shouldOpenInChat(
          sig.agent,
          usePreferencesStore.getState().agentOpenInChat,
          tracked,
        )
      ) {
        openReader(leafId);
      }
      return;
    }
    case "working":
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "attention", ctx);
      return;
    }
    case "finished": {
      store.setStatus(leafId, "done");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", ctx);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "linked":
      if (sig.session) store.setClaudeSession(leafId, sig.session);
      return;
    case "exited":
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
  }
}

export function AgentNotificationsBridge({
  tabs,
  activeId,
  onActivate,
}: {
  tabs: Tab[];
  activeId: number;
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  usePhaseReconciler();
  const ctxRef = useRef<Ctx>({ tabs, activeId, focused, onActivate });
  ctxRef.current = { tabs, activeId, focused, onActivate };

  // Structured hooks name the agent's session (Claude's transcript id),
  // which the legacy signals no longer carry: link each pane to it.
  useEffect(
    () =>
      subscribeAgentEvents((event) => {
        const sessionId = claudeSessionOf(event);
        if (!sessionId) return;
        useAgentActivityStore.getState().setSessionId(event.ptyId, sessionId);
        const leafId = leafIdForPty(event.ptyId);
        if (leafId !== null) {
          useAgentStore.getState().setClaudeSession(leafId, sessionId);
        }
      }),
    [],
  );

  // Shares the terminal module's single `terax:agent-signal` listener.
  useEffect(
    () =>
      subscribeAgentSignals((signal) =>
        handleSignal(signal as AgentSignal, ctxRef.current),
      ),
    [],
  );

  return null;
}
