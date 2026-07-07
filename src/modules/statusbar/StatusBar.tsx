import IncognitoIcon from "@hugeicons/core-free-icons/IncognitoIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { statusBadgeClass } from "@/lib/statusTone";
import { cn } from "@/lib/utils";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import { useChatStore } from "@/modules/ai/store/chatStore";
import type { WorkspaceEnv } from "@/modules/workspace";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  onOpenAgentPanel?: () => void;
  conversationOpen?: boolean;
  agentPanelOpen?: boolean;
  /** Only rendered when the agent panel is open and a runtime is available. */
  hasComposer: boolean;
  privateActive: boolean;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  onOpenMini,
  onOpenAgentPanel,
  conversationOpen,
  agentPanelOpen,
  hasComposer,
  privateActive,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);
  const effectivePanelOpen = agentPanelOpen ?? panelOpen;
  const openEffectivePanel = onOpenAgentPanel ?? openPanel;

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div
        data-testid="cwd-breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "flex shrink-0 cursor-default items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium",
                  statusBadgeClass("warning"),
                )}
              >
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private: hidden from AI</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[11px] leading-relaxed"
            >
              AI can't see this terminal's output. Use it for secrets, SSH, or
              anything you don't want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AgentStatusPill onClick={onOpenMini} />
        {effectivePanelOpen && hasComposer ? (
          <AiStatusBarControls
            conversationOpen={conversationOpen}
            onOpenConversation={onOpenMini}
          />
        ) : (
          <AiOpenButton onOpen={openEffectivePanel} />
        )}
      </div>
    </footer>
  );
}
