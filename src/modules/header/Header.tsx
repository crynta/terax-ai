import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { chromeHideMode } from "@/modules/settings/store";
import { ShortcutTip } from "@/modules/shortcuts/ShortcutTip";
import type { Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import { useActiveShellTool } from "@/modules/terminal/lib/shellToolStore";
import {
  CommandIcon,
  Settings01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
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
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Move a dragged tab to a new position (insertion gap index). */
  onReorder: (fromId: number, toGapIndex: number) => void;
  onOverrideLanguage?: (id: number, lang: string | null) => void;
  onToggleSidebar: () => void;
  onOpenCommandPalette: () => void;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenSettings: () => void;
  spaceSwitcher: ReactNode;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
};

const COMPACT_WIDTH = 720;

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onClose,
  onPin,
  onRename,
  onReorder,
  onOverrideLanguage,
  onToggleSidebar,
  onOpenCommandPalette,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenSettings,
  spaceSwitcher,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  // Global pref or shell-tool chrome mode "disable" removes the toggle.
  const sidebarPrefDisabled = usePreferencesStore((s) => s.sidebarDisabled);
  const toolSidebarMode = chromeHideMode(useActiveShellTool()?.hideSidebar);
  const sidebarDisabled = sidebarPrefDisabled || toolSidebarMode === "disable";

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
    <ShortcutTip label="Settings" shortcutId="settings.open">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onOpenSettings}
      >
        <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
      </Button>
    </ShortcutTip>
  );

  const commandPaletteButton = (
    <ShortcutTip label="Command palette" shortcutId="commandPalette.open">
      <Button
        size="icon"
        variant="ghost"
        onClick={onOpenCommandPalette}
        className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={CommandIcon} size={16} strokeWidth={1.75} />
      </Button>
    </ShortcutTip>
  );

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      // A press on a drag surface starts the native window drag and never
      // reaches Radix's document listeners, so open popovers stay up.
      // Re-emit the pointerdown from <body> — outside every layer — to
      // dismiss them. Presses on buttons bubble here with a non-drag target
      // and are left alone.
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).hasAttribute("data-tauri-drag-region"))
          return;
        // Radix defers left-button outside-dismissal until the matching
        // `click`, which the native drag swallows — emit both.
        document.body.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true }),
        );
        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }}
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        {!sidebarDisabled && (
          <ShortcutTip label="Toggle sidebar" shortcutId="sidebar.toggle">
            <Button
              onClick={onToggleSidebar}
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon
                icon={SidebarLeftIcon}
                size={18}
                strokeWidth={1.75}
                className="size-4.5"
              />
            </Button>
          </ShortcutTip>
        )}

        {!IS_MAC && (
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
        )}
      </div>

      {!IS_MAC && <span className="mx-1 h-full w-px shrink-0 bg-border/70" />}

      {IS_MAC && <span className="mr-1 h-full w-px shrink-0 bg-border/70" />}

      <div
        className="flex min-w-0 flex-1 items-center gap-0.5"
        data-tauri-drag-region
      >
        {spaceSwitcher}
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onNewBlock={onNewBlock}
          onNewPrivate={onNewPrivate}
          onNewPreview={onNewPreview}
          onNewEditor={onNewEditor}
          onNewGitGraph={onNewGitGraph}
          onClose={onClose}
          onPin={onPin}
          onRename={onRename}
          onReorder={onReorder}
          onOverrideLanguage={onOverrideLanguage}
          compact={compact}
        />
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      <SearchInline ref={searchRef} target={searchTarget} compact />

      {IS_MAC && (
        <>
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
          {commandPaletteButton}
          {settingsButton}
        </>
      )}

      {!IS_MAC && (
        <>
          {commandPaletteButton}
          {settingsButton}
        </>
      )}

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border/60" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
