import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  getSourceControlRemoteIndicator,
  type SourceControlSummary,
} from "@/modules/source-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, KEY_SEP, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getBindingTokens,
  SHORTCUTS,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import type { Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import {
  GridViewIcon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  ReloadIcon,
  SourceCodeCircleIcon,
  Settings01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  onToggleSidebar: () => void;
  onSplit: (dir: "row" | "col") => void;
  /** Active tab is a terminal and below the per-tab pane cap. */
  canSplit: boolean;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
  sourceControlOpen: boolean;
  sourceControl: SourceControlSummary;
  onToggleSourceControl: () => void;
  onRunSourceControlRemoteAction: () => void;
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
  onClose,
  onPin,
  onToggleSidebar,
  onSplit,
  canSplit,
  onOpenShortcuts,
  onOpenSettings,
  sourceControlOpen,
  sourceControl,
  onToggleSourceControl,
  onRunSourceControlRemoteAction,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);

  const tokensFor = (id: ShortcutId): string => {
    const s = SHORTCUTS.find((s) => s.id === id);
    if (!s) return "";
    const bindings = userShortcuts[id] || s.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join(KEY_SEP);
  };

  const shortcutLabel = useMemo(() => {
    const tokens = tokensFor("shortcuts.open");
    return tokens ? `Keyboard shortcuts (${tokens})` : "Keyboard shortcuts";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userShortcuts]);

  const splitRightTokens = tokensFor("pane.splitRight");
  const splitDownTokens = tokensFor("pane.splitDown");
  const remoteIndicator = getSourceControlRemoteIndicator(sourceControl);

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

  const shortcutsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenShortcuts}
      title={shortcutLabel}
    >
      <HugeiconsIcon icon={KeyboardIcon} size={16} strokeWidth={1.75} />
    </Button>
  );

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      title="Settings"
    >
      <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  const sourceControlButton = (
    <div
      className={cn(
        "relative inline-flex h-7 shrink-0 items-stretch overflow-visible rounded-md border text-[11px]",
        sourceControlOpen
          ? "border-border bg-secondary text-secondary-foreground"
          : "border-border/60 bg-transparent text-muted-foreground",
      )}
    >
      <button
        type="button"
        className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-l-[5px] px-2.5 transition-colors hover:bg-accent/80 hover:text-foreground"
        onClick={onToggleSourceControl}
        title="Source Control"
      >
        <span className="relative inline-flex size-3.5 items-center justify-center">
          <HugeiconsIcon
            icon={SourceCodeCircleIcon}
            size={14}
            strokeWidth={1.75}
          />
          {sourceControl.changedCount > 0 ? (
            <span className="absolute -right-2 -top-2 inline-flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 py-px text-[8px] font-semibold leading-none text-primary-foreground shadow-sm ring-1 ring-card">
              {sourceControl.changedCount > 99 ? "99+" : sourceControl.changedCount}
            </span>
          ) : null}
        </span>
        <span className="pt-[1px] leading-none">Diff</span>
      </button>
      {remoteIndicator.visible ? (
        <button
          type="button"
          className={cn(
            "relative inline-flex w-7 cursor-pointer items-center justify-center rounded-r-[5px] border-l border-border/60 transition-colors hover:bg-accent/80 hover:text-foreground",
            remoteIndicator.disabled &&
              "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-muted-foreground",
          )}
          disabled={remoteIndicator.disabled}
          onClick={onRunSourceControlRemoteAction}
          title={remoteIndicator.title}
        >
          {sourceControl.busyAction ? (
            <Spinner className="size-3" />
          ) : (
            <>
              <HugeiconsIcon
                icon={ReloadIcon}
                size={13}
                strokeWidth={1.85}
                className={cn(
                  (sourceControl.ahead > 0 || sourceControl.behind > 0) &&
                    "text-foreground",
                )}
              />
              {remoteIndicator.label !== "Sync" ? (
                <span className="absolute -right-1 -top-1 inline-flex min-w-3.5 items-center justify-center rounded-full bg-muted px-1 py-px text-[8px] font-semibold leading-none text-foreground ring-1 ring-card">
                  {remoteIndicator.label.replace(" ", "")}
                </span>
              ) : null}
            </>
          )}
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              title="Split terminal"
              disabled={!canSplit}
            >
              <HugeiconsIcon icon={GridViewIcon} size={16} strokeWidth={1.75} />
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

        {!IS_MAC && shortcutsButton}
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
          onClose={onClose}
          onPin={onPin}
          compact={compact}
        />
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      <SearchInline ref={searchRef} target={searchTarget} compact={compact} />

      {sourceControlButton}

      {IS_MAC && (
        <>
          {shortcutsButton}
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
