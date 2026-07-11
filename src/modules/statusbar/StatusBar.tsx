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
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { ShellTool } from "@/modules/settings/store";
import { KbdChip } from "@/modules/shortcuts/KbdChip";
import { ShortcutTip } from "@/modules/shortcuts/ShortcutTip";
import { useShortcutText } from "@/modules/shortcuts/useShortcutText";
import type { WorkspaceEnv } from "@/modules/workspace";
import {
  ArrowUpLeft01Icon,
  IncognitoIcon,
  KeyboardIcon,
  LayoutBottomIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  /** Shell tool (nvim etc.) currently in the active terminal's foreground. */
  shellTool?: ShellTool | null;
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
  shellTool,
}: Props) {
  const panelOpen = useChatStore((s) => s.panelOpen);
  const openPanel = useChatStore((s) => s.openPanel);
  const collapsed = useStatusBarCollapsed((s) => s.collapsed);
  const toolHidden = useStatusBarCollapsed((s) => s.toolHidden);
  const hintsOn = usePreferencesStore((s) => s.hoverKeybindHints);
  const toggleCollapsed = useStatusBarCollapsed((s) => s.toggle);
  const hidden = collapsed || toolHidden;

  const toggleShortcutText = useShortcutText("statusbar.toggle");

  return (
    <>
      <footer
        className={`flex shrink-0 items-center justify-between gap-3 overflow-hidden border-border/60 bg-card/60 px-3 text-[11px] transition-[height] duration-[calc(200ms*var(--terax-anim,1))] ease-out ${
          hidden ? "h-0 border-t-0" : "h-10 border-t"
        }`}
        aria-hidden={hidden}
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
          {shellTool ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10.5px] font-medium text-sky-700 dark:text-sky-400">
                  <HugeiconsIcon
                    icon={KeyboardIcon}
                    size={11}
                    strokeWidth={2}
                  />
                  <span>{shellTool.name}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-64 text-[11px] leading-relaxed"
              >
                {(shellTool.shortcutMode ??
                  (shellTool.blockShortcuts ? "none" : "all")) !== "all"
                  ? `${shellTool.name} is in the foreground — app keybindings are passed through to it while the terminal is focused.`
                  : `${shellTool.name} is in the foreground.`}
              </TooltipContent>
            </Tooltip>
          ) : null}
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
              tabIndex={hidden ? -1 : undefined}
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
          switcher) takes over — the floating tab would overlap the input bar.
          Tool-hidden state shows no tab either: the bar comes back by itself
          when the shell tool exits. */}
      {collapsed && !toolHidden && !(panelOpen && hasComposer) && (
        <button
          type="button"
          onClick={toggleCollapsed}
          title={
            toggleShortcutText
              ? `Show status bar (${toggleShortcutText})`
              : "Show status bar"
          }
          // Corner wedge: a quarter-disc hugging the window's bottom-right
          // corner, chevron pointing diagonally out of it. Gradient fill +
          // soft glow so it reads as a physical tab, not a hairline.
          // Hover growth via transform scale (not width/height) and no
          // backdrop-blur: both are compositor-only, so nothing re-lays-out
          // mid-animation and the entrance stays smooth.
          className="group fixed right-0 bottom-0 z-30 flex size-8 origin-bottom-right items-end justify-end rounded-tl-full border border-r-0 border-b-0 border-border/70 bg-gradient-to-tl from-accent/80 via-card/80 to-card/30 pr-1.5 pb-1 text-muted-foreground/70 shadow-[-3px_-3px_12px_-4px_rgba(0,0,0,0.5)] transition-[scale,color,border-color] duration-[calc(250ms*var(--terax-anim,1))] ease-out animate-in fade-in-0 zoom-in-50 [animation-duration:calc(400ms*var(--terax-anim,1))] [animation-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:scale-125 hover:border-foreground/25 hover:text-foreground active:scale-110"
        >
          <HugeiconsIcon
            icon={ArrowUpLeft01Icon}
            size={13}
            strokeWidth={2}
            className="transition-transform duration-[calc(250ms*var(--terax-anim,1))] group-hover:-translate-x-px group-hover:-translate-y-px"
          />
          {toggleShortcutText && hintsOn && (
            <span className="pointer-events-none absolute right-1 bottom-10 translate-y-1 opacity-0 transition-all duration-[calc(250ms*var(--terax-anim,1))] group-hover:translate-y-0 group-hover:opacity-100">
              <KbdChip className="px-1.5 py-0.5">{toggleShortcutText}</KbdChip>
            </span>
          )}
        </button>
      )}
    </>
  );
}
