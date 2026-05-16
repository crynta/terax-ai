import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ComputerTerminal02Icon,
  Globe02Icon,
  IncognitoIcon,
  ServerStack03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { SessionType } from "@/modules/tabs";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  workspace?: WorkspaceEnv;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  /** Only rendered when the AI panel is open and a key is loaded. */
  hasComposer: boolean;
  privateActive: boolean;
  sessionType?: SessionType;
  sessionName?: string;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  workspace,
  onCd,
  onWorkspaceChange,
  onOpenMini,
  hasComposer,
  privateActive,
  sessionType,
  sessionName,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);

  const sessionIcon = () => {
    if (sessionType === "ssh")
      return <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.75} className="text-blue-600 dark:text-blue-400" />;
    if (sessionType === "wsl")
      return <HugeiconsIcon icon={ServerStack03Icon} size={13} strokeWidth={1.75} className="text-emerald-600 dark:text-emerald-400" />;
    return <HugeiconsIcon icon={ComputerTerminal02Icon} size={13} strokeWidth={1.75} />;
  };

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        {sessionName && sessionName !== "shell" ? (
          <span className="flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] text-muted-foreground">
            {sessionIcon()}
            <span className="max-w-28 truncate">{sessionName}</span>
          </span>
        ) : null}
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} workspace={workspace} onCd={onCd} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private: hidden from AI</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-[11px] leading-relaxed">
              AI can't see this terminal's output. Use it for secrets, SSH, or
              anything you don't want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AgentStatusPill onClick={onOpenMini} />
        {panelOpen && hasComposer ? (
          <AiStatusBarControls />
        ) : (
          <AiOpenButton onOpen={openPanel} />
        )}
      </div>
    </footer>
  );
}
