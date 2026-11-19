import { slotOf } from "@/modules/workbench/components/slot";
import { snapshot } from "@/modules/workbench/store";
import type { Tab } from "@/modules/tabs";
import { leafIdForPty, subscribeAgentSignals } from "@/modules/terminal";
import { useEffect, useRef } from "react";
import { displayAgent } from "../lib/format";
import { maybeTriggerManagedReview } from "../lib/review";
import { routeAgentNotification } from "../lib/route";
import type { AgentSession, AgentSignal } from "../lib/types";
import { useWindowFocus } from "../lib/useWindowFocus";
import { useAgentStore } from "../store/agentStore";
import { useManagedAgentsStore } from "../store/managedAgentsStore";

type Activate = (tabId: number, leafId: number) => void;
type Ctx = {
  getTabs: () => readonly Tab[];
  focused: boolean;
  onActivate: Activate;
};

function tabInfo(
  tabs: readonly Tab[],
  leafId: number,
): { tabId: number; title: string } | null {
  for (const t of tabs) {
    if (t.kind === "terminal" && t.id === leafId) {
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
  const info = tabInfo(ctx.getTabs(), session.leafId);
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
    visible: slotOf(snapshot(), session.tabId)?.visible ?? false,
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
      const info = tabInfo(ctx.getTabs(), leafId);
      if (!info) return;
      store.start(leafId, info.tabId, sig.agent ?? "agent");
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
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", ctx);
      maybeTriggerManagedReview(leafId);
      return;
    }
    case "exited":
      store.finish(leafId);
      useManagedAgentsStore.getState().remove(leafId);
      return;
  }
}

export function AgentNotificationsBridge({
  getTabs,
  onActivate,
}: {
  getTabs: () => readonly Tab[];
  onActivate: Activate;
}) {
  const focused = useWindowFocus();
  const ctxRef = useRef<Ctx>({ getTabs, focused, onActivate });
  ctxRef.current = { getTabs, focused, onActivate };

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
