import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import { useChatStore } from "@/modules/ai";
import { invoke } from "@tauri-apps/api/core";
import { Globe02Icon, Message01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";

type CopilotCliStatus = {
  available: boolean;
  version: string | null;
};

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onOpenMini: () => void;
  /** Only rendered when the AI panel is open and a key is loaded. */
  hasComposer: boolean;
  onOpenCopilot: () => void;
  onLoginCopilot: () => void;
  /** When set, render a one-click "Open preview" chip pointing at this URL. */
  detectedPreviewUrl?: string | null;
  onOpenPreview?: () => void;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onOpenMini,
  hasComposer,
  onOpenCopilot,
  onLoginCopilot,
  detectedPreviewUrl,
  onOpenPreview,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);
  const [copilotStatus, setCopilotStatus] =
    useState<CopilotCliStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void invoke<CopilotCliStatus>("copilot_cli_status")
      .then((status) => {
        if (alive) setCopilotStatus(status);
      })
      .catch(() => {
        if (alive) setCopilotStatus({ available: false, version: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div className="min-w-0 flex-1 truncate">
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {detectedPreviewUrl && onOpenPreview ? (
          <button
            type="button"
            onClick={onOpenPreview}
            title={`Open ${detectedPreviewUrl} as a preview tab`}
            className="flex h-6 max-w-64 items-center gap-1.5 rounded-md border border-border/70 bg-accent/40 px-2 text-[11px] text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Globe02Icon}
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate">Open preview</span>
            <span className="truncate text-muted-foreground">
              {hostFromUrl(detectedPreviewUrl)}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenCopilot}
          disabled={!copilotStatus?.available}
          title={
            copilotStatus?.available
              ? `Open GitHub Copilot CLI (${copilotStatus.version ?? "installed"})`
              : "Install and sign in to GitHub Copilot CLI to enable this"
          }
          className="flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-border/60 disabled:hover:bg-card disabled:hover:text-muted-foreground"
        >
          <HugeiconsIcon
            icon={Message01Icon}
            size={11}
            strokeWidth={1.75}
            className="shrink-0"
          />
          <span>Copilot</span>
        </button>
        {copilotStatus?.available ? (
          <button
            type="button"
            onClick={onLoginCopilot}
            title="Authenticate GitHub Copilot CLI with copilot login"
            className="flex h-6 items-center rounded-md border border-border/60 bg-card px-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
          >
            Auth
          </button>
        ) : null}
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

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
