import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import { LspStatusPill } from "@/modules/lsp";
import type { SpaceRootIssue } from "@/modules/spaces/lib/spaceRoot";
import type { WorkspaceEnv } from "@/modules/workspace";
import { IncognitoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { SpaceRootBreadcrumb } from "./CwdBreadcrumb";
import { DiagnosticsBadge } from "./DiagnosticsBadge";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

type Props = {
  root: string | null;
  home: string | null;
  issue?: SpaceRootIssue;
  env: WorkspaceEnv | null;
  filePath: string | null;
  onChangeRoot: (path: string) => void;
  onCreateInEnv: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  onOpenAi: () => void;
  hasComposer: boolean;
  privateActive: boolean;
};

export function StatusBar({
  root,
  home,
  issue,
  env,
  filePath,
  onChangeRoot,
  onCreateInEnv,
  onOpenMini,
  onOpenAi,
  hasComposer,
  privateActive,
}: Props) {
  const panelOpen = useChatStore((state) => state.panelOpen);

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 pl-3 pr-4 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {env ? (
          <WorkspaceEnvSelector env={env} onCreateInEnv={onCreateInEnv} />
        ) : null}
        <SpaceRootBreadcrumb
          root={root}
          home={home}
          issue={issue}
          env={env}
          onChangeRoot={onChangeRoot}
        />
        <LspStatusPill filePath={filePath} />
        <DiagnosticsBadge filePath={filePath} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private: hidden from AI</span>
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-64 text-[11px] leading-relaxed"
            >
              AI can&apos;t see this terminal&apos;s output. Use it for secrets,
              SSH, or anything you don&apos;t want sent to the model.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <AgentStatusPill onClick={onOpenMini} />
        {panelOpen && hasComposer ? (
          <AiStatusBarControls />
        ) : (
          <AiOpenButton onOpen={onOpenAi} />
        )}
      </div>
    </footer>
  );
}
