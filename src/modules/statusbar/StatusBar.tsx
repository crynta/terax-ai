import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KEY_SEP } from "@/lib/platform";
import { useChatStore } from "@/modules/ai";
import { AgentStatusPill } from "@/modules/ai/components/AgentStatusPill";
import {
  AiOpenButton,
  AiStatusBarControls,
} from "@/modules/ai/components/AiStatusBarControls";
import { LspStatusPill } from "@/modules/lsp";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { ShortcutTip } from "@/modules/shortcuts/ShortcutTip";
import { getBindingTokens, SHORTCUTS } from "@/modules/shortcuts/shortcuts";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  ArrowUp01Icon,
  IncognitoIcon,
  LayoutBottomIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo } from "react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { DiagnosticsBadge } from "./DiagnosticsBadge";
import { useStatusBarCollapsed } from "./lib/useStatusBarCollapsed";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  onOpenMini: () => void;
  /** Only rendered when the AI panel is open and a key is loaded. */
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
  hasComposer,
  privateActive,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);
  const collapsed = useStatusBarCollapsed((s) => s.collapsed);
  const toggleCollapsed = useStatusBarCollapsed((s) => s.toggle);

  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const toggleShortcutText = useMemo(() => {
    const s = SHORTCUTS.find((x) => x.id === "statusbar.toggle");
    const bindings = userShortcuts["statusbar.toggle"] || s?.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join(KEY_SEP);
  }, [userShortcuts]);

  return (
    <>
      <footer
        className={`flex shrink-0 items-center justify-between gap-3 overflow-hidden border-border/60 bg-card/60 px-3 text-[11px] transition-[height] duration-[calc(200ms*var(--terax-anim,1))] ease-out ${
          collapsed ? "h-0 border-t-0" : "h-10 border-t"
        }`}
        aria-hidden={collapsed}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
          <CwdBreadcrumb
            cwd={cwd}
            filePath={filePath}
            home={home}
            onCd={onCd}
          />
          <LspStatusPill filePath={filePath ?? null} />
          <DiagnosticsBadge filePath={filePath ?? null} />
          {privateActive ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                  <HugeiconsIcon
                    icon={IncognitoIcon}
                    size={11}
                    strokeWidth={2}
                  />
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
          {panelOpen && hasComposer ? (
            <AiStatusBarControls />
          ) : (
            <AiOpenButton onOpen={openPanel} />
          )}
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border/60" aria-hidden />
          <ShortcutTip label="Hide status bar" shortcutId="statusbar.toggle">
            <button
              type="button"
              tabIndex={collapsed ? -1 : undefined}
              onClick={toggleCollapsed}
              title="Hide status bar"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                icon={LayoutBottomIcon}
                size={15}
                strokeWidth={1.75}
              />
            </button>
          </ShortcutTip>
        </div>
      </footer>
      {/* When the AI composer is open, its inline button (next to the agent
          switcher) takes over — the floating tab would overlap the input bar. */}
      {collapsed && !(panelOpen && hasComposer) && (
        <button
          type="button"
          onClick={toggleCollapsed}
          title={
            toggleShortcutText
              ? `Show status bar (${toggleShortcutText})`
              : "Show status bar"
          }
          className="group fixed right-3 bottom-0 z-30 flex h-3.5 min-w-9 items-center justify-center rounded-t-md border border-b-0 border-border/60 bg-card/90 px-2.5 text-muted-foreground/60 backdrop-blur transition-all duration-[calc(250ms*var(--terax-anim,1))] animate-in fade-in-0 slide-in-from-bottom-2 hover:h-8 hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={13} strokeWidth={2} />
          {toggleShortcutText && (
            <span className="flex max-w-0 items-center overflow-hidden opacity-0 transition-all duration-[calc(250ms*var(--terax-anim,1))] group-hover:ml-1.5 group-hover:max-w-16 group-hover:opacity-100">
              <kbd className="rounded border border-border/50 bg-card px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none whitespace-nowrap text-muted-foreground select-none">
                {toggleShortcutText}
              </kbd>
            </span>
          )}
        </button>
      )}
    </>
  );
}
