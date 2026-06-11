import type { ComponentProps } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AgentNotificationsBridge } from "@/modules/agents";
import { AgentRunBridge } from "@/modules/ai/components/lazy";
import { LocalAgentNotificationsBridge } from "@/modules/ai/components/LocalAgentNotificationsBridge";
import { PiNotificationsBridge } from "@/modules/pi/components/PiNotificationsBridge";
import type { Tab } from "@/modules/tabs";

type AppBridgesProps = {
  tabs: Tab[];
  activeId: number;
  hasComposer: boolean;
  piSidebarVisible: boolean;
  onActivateAgent: ComponentProps<
    typeof AgentNotificationsBridge
  >["onActivate"];
  onActivatePiSession: ComponentProps<
    typeof PiNotificationsBridge
  >["onActivateSession"];
  openAiDiffTab: ComponentProps<typeof AgentRunBridge>["openAiDiffTab"];
  closeAiDiffTab: ComponentProps<typeof AgentRunBridge>["closeAiDiffTab"];
};

/**
 * Background notification/event bridges plus the toast portal. These render no
 * visible chrome of their own; they wire app events to the agent/pi stores and
 * the diff-tab surface. The composer-gated pair only mounts once an AI provider
 * is configured (`hasComposer`).
 */
export function AppBridges({
  tabs,
  activeId,
  hasComposer,
  piSidebarVisible,
  onActivateAgent,
  onActivatePiSession,
  openAiDiffTab,
  closeAiDiffTab,
}: AppBridgesProps) {
  return (
    <>
      <AgentNotificationsBridge
        tabs={tabs}
        activeId={activeId}
        onActivate={onActivateAgent}
      />
      <PiNotificationsBridge
        visible={piSidebarVisible}
        onActivateSession={onActivatePiSession}
      />
      <Toaster position="bottom-right" />

      {hasComposer ? (
        <>
          <AgentRunBridge
            openAiDiffTab={openAiDiffTab}
            closeAiDiffTab={closeAiDiffTab}
          />
          <LocalAgentNotificationsBridge />
        </>
      ) : null}
    </>
  );
}
