import { lazy, Suspense } from "react";
import { PaneLoadingFallback } from "@/components/PaneLoadingFallback";
import type { AgentRunBridgeProps } from "./AgentRunBridge";
import type { SelectionAskAiProps } from "./SelectionAskAi";

const AgentRunBridgeInner = lazy(() =>
  import("./AgentRunBridge").then((m) => ({ default: m.AgentRunBridge })),
);

const AiMiniWindowInner = lazy(() =>
  import("./AiMiniWindow").then((m) => ({ default: m.AiMiniWindow })),
);

const AiInputBarModule = () => import("./AiInputBar");

const AiInputBarInner = lazy(() =>
  AiInputBarModule().then((m) => ({ default: m.AiInputBar })),
);

const AiInputBarConnectInner = lazy(() =>
  AiInputBarModule().then((m) => ({ default: m.AiInputBarConnect })),
);

const SelectionAskAiInner = lazy(() =>
  import("./SelectionAskAi").then((m) => ({ default: m.SelectionAskAi })),
);

export function AgentRunBridge(props: AgentRunBridgeProps) {
  return (
    <Suspense fallback={null}>
      <AgentRunBridgeInner {...props} />
    </Suspense>
  );
}

export function AiMiniWindow() {
  return (
    <Suspense fallback={<PaneLoadingFallback label="Loading AI window…" />}>
      <AiMiniWindowInner />
    </Suspense>
  );
}

export function AiInputBar() {
  return (
    <Suspense
      fallback={
        <PaneLoadingFallback
          label="Loading composer…"
          className="min-h-14 border-t border-x-0 border-b-0"
        />
      }
    >
      <AiInputBarInner />
    </Suspense>
  );
}

export function AiInputBarConnect({ onAdd }: { onAdd: () => void }) {
  return (
    <Suspense fallback={<PaneLoadingFallback label="Loading composer…" />}>
      <AiInputBarConnectInner onAdd={onAdd} />
    </Suspense>
  );
}

export function SelectionAskAi(props: SelectionAskAiProps) {
  return (
    <Suspense fallback={null}>
      <SelectionAskAiInner {...props} />
    </Suspense>
  );
}
