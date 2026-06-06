import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import LayoutTwoColumnIcon from "@hugeicons/core-free-icons/LayoutTwoColumnIcon";
import LayoutTwoRowIcon from "@hugeicons/core-free-icons/LayoutTwoRowIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, KEY_SEP, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import type { AgentStatusContext } from "@/modules/agents/lib/statusSurface";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setSidebarPosition } from "@/modules/settings/store";
import {
  getBindingTokens,
  SHORTCUTS,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import type { Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import {
  SearchInline,
  type SearchInlineHandle,
  type SearchTarget,
} from "./SearchInline";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewWorkflow: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  onToggleSidebar: () => void;
  onToggleSecondarySidebar: () => void;
  onSplit: (dir: "row" | "col") => void;
  /** Active tab is a terminal and below the per-tab pane cap. */
  canSplit: boolean;
  agentTerminalContext: Record<number, AgentStatusContext>;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onActivatePiSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
};

const COMPACT_WIDTH = 720;

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewWorkflow,
  onNewGitGraph,
  onClose,
  onPin,
  onRename,
  onToggleSidebar,
  onToggleSecondarySidebar,
  onSplit,
  canSplit,
  agentTerminalContext,
  onActivateAgent,
  onActivateLocalAgent,
  onActivatePiSession,
  onOpenSettings,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);
  const sidebarPosition = usePreferencesStore((s) => s.sidebarPosition);

  const tokensFor = (id: ShortcutId): string => {
    const s = SHORTCUTS.find((s) => s.id === id);
    if (!s) return "";
    const bindings = userShortcuts[id] || s.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join(KEY_SEP);
  };

  const splitRightTokens = tokensFor("pane.splitRight");
  const splitDownTokens = tokensFor("pane.splitDown");

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      aria-label="Settings"
      title="Settings"
    >
      <HugeiconsIcon
        aria-hidden="true"
        focusable="false"
        icon={Settings01Icon}
        size={15}
        strokeWidth={1.75}
      />
    </Button>
  );
  const sidebarIcon =
    sidebarPosition === "right" ? SidebarRightIcon : SidebarLeftIcon;

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Button
              onClick={onToggleSidebar}
              aria-label="Toggle primary sidebar"
              title="Toggle primary sidebar. Right-click for sidebar options."
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                aria-hidden="true"
                focusable="false"
                icon={sidebarIcon}
                size={18}
                strokeWidth={1.75}
              />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-48">
            <ContextMenuItem onSelect={onToggleSecondarySidebar}>
              Toggle Code sidebar
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuRadioGroup
              value={sidebarPosition}
              onValueChange={(value) => {
                if (value === "left" || value === "right") {
                  void setSidebarPosition(value);
                }
              }}
            >
              <ContextMenuRadioItem value="left">
                Primary sidebar left
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="right">
                Primary sidebar right
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuContent>
        </ContextMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label="Split terminal"
              title="Split terminal"
              disabled={!canSplit}
            >
              <HugeiconsIcon
                aria-hidden="true"
                focusable="false"
                icon={GridViewIcon}
                size={16}
                strokeWidth={1.75}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuItem onSelect={() => onSplit("row")}>
              <HugeiconsIcon
                icon={LayoutTwoColumnIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Split right</span>
              {splitRightTokens && (
                <span className="text-xs text-muted-foreground">
                  {splitRightTokens}
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSplit("col")}>
              <HugeiconsIcon
                icon={LayoutTwoRowIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Split down</span>
              {splitDownTokens && (
                <span className="text-xs text-muted-foreground">
                  {splitDownTokens}
                </span>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!IS_MAC && (
          <NotificationBell
            terminalContext={agentTerminalContext}
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
            onActivatePi={onActivatePiSession}
          />
        )}
      </div>

      {!IS_MAC && <span className="mx-1 h-5 w-px shrink-0 bg-border" />}

      {IS_MAC && <span className="mr-1 h-full w-px shrink-0 bg-border" />}

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-tauri-drag-region
      >
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onNewPrivate={onNewPrivate}
          onNewPreview={onNewPreview}
          onNewEditor={onNewEditor}
          onNewWorkflow={onNewWorkflow}
          onNewGitGraph={onNewGitGraph}
          onClose={onClose}
          onPin={onPin}
          onRename={onRename}
          compact={compact}
        />
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      <SearchInline ref={searchRef} target={searchTarget} compact={compact} />

      {IS_MAC && (
        <>
          <NotificationBell
            terminalContext={agentTerminalContext}
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
            onActivatePi={onActivatePiSession}
          />
          {settingsButton}
        </>
      )}

      {!IS_MAC && settingsButton}

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
