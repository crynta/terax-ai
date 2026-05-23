import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  SourceControlPanel,
  type SourceControlSummary,
} from "@/modules/source-control";
import type { Tab } from "@/modules/tabs";
import {
  Clock01Icon,
  FolderGitTwoIcon,
  FolderTreeIcon,
  GridViewIcon,
  ListViewIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { PanelTabStrip, type PanelDescriptor } from "./PanelTabStrip";
import { OutlinePanel } from "./panels/OutlinePanel";
import { RecentFilesPanel } from "./panels/RecentFilesPanel";
import { VerticalTabsPanel } from "./panels/VerticalTabsPanel";
import { WorkspaceSearchPanel } from "./panels/WorkspaceSearchPanel";
import {
  SIDEBAR_PANEL_META,
  type SidebarPanelMeta,
  type SidebarViewId,
} from "./types";

type ViewProps = {
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  sidebarRef: RefObject<PanelImperativeHandle | null>;
  sidebarWidthRef: RefObject<number>;
};

type ExplorerProps = {
  explorerRef: RefObject<FileExplorerHandle | null>;
  explorerRoot: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed: (from: string, to: string) => void;
  onPathDeleted: (path: string) => void;
  onRevealInTerminal: (path: string) => void;
  onAttachToAgent: (path: string) => void;
  onOpenMarkdownPreview: (path: string) => void;
};

type SourceControlProps = {
  sourceControl: SourceControlSummary;
  onOpenDiff: (params: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    title?: string;
  }) => void;
  onOpenGitGraph: () => void;
};

type TabsProps = {
  tabs: Tab[];
  activeTabId: number;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onNewTab: () => void;
};

type Props = ViewProps &
  ExplorerProps &
  SourceControlProps &
  TabsProps & {
    activeEditorHandle: EditorPaneHandle | null;
  };

const PANEL_ICONS: Record<SidebarViewId, PanelDescriptor["icon"]> = {
  explorer: FolderTreeIcon,
  "source-control": FolderGitTwoIcon,
  tabs: GridViewIcon,
  search: Search01Icon,
  outline: ListViewIcon,
  recent: Clock01Icon,
};

export function SidebarPanelHost({
  activeView,
  onSelectView,
  sidebarRef,
  sidebarWidthRef,
  explorerRef,
  explorerRoot,
  onOpenFile,
  onPathRenamed,
  onPathDeleted,
  onRevealInTerminal,
  onAttachToAgent,
  onOpenMarkdownPreview,
  sourceControl,
  onOpenDiff,
  onOpenGitGraph,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  activeEditorHandle,
}: Props) {
  const panelExplorer = usePreferencesStore((s) => s.sidebarPanelExplorer);
  const panelSourceControl = usePreferencesStore(
    (s) => s.sidebarPanelSourceControl,
  );
  const panelTabs = usePreferencesStore((s) => s.sidebarPanelTabs);
  const panelSearch = usePreferencesStore((s) => s.sidebarPanelSearch);
  const panelOutline = usePreferencesStore((s) => s.sidebarPanelOutline);
  const panelRecent = usePreferencesStore((s) => s.sidebarPanelRecent);

  const enabledMeta = useMemo<SidebarPanelMeta[]>(() => {
    const enabled: Record<SidebarViewId, boolean> = {
      explorer: panelExplorer,
      "source-control": panelSourceControl,
      tabs: panelTabs,
      search: panelSearch,
      outline: panelOutline,
      recent: panelRecent,
    };
    return SIDEBAR_PANEL_META.filter((m) => enabled[m.id]);
  }, [
    panelExplorer,
    panelSourceControl,
    panelTabs,
    panelSearch,
    panelOutline,
    panelRecent,
  ]);

  const descriptors = useMemo<PanelDescriptor[]>(
    () =>
      enabledMeta.map((m) => ({
        id: m.id,
        label: m.label,
        icon: PANEL_ICONS[m.id],
        badge:
          m.id === "source-control"
            ? sourceControl.changedCount || undefined
            : undefined,
      })),
    [enabledMeta, sourceControl.changedCount],
  );

  useEffect(() => {
    if (enabledMeta.length === 0) return;
    if (enabledMeta.some((m) => m.id === activeView)) return;
    onSelectView(enabledMeta[0]!.id);
  }, [enabledMeta, activeView, onSelectView]);

  const handleSelectView = useCallback(
    (id: SidebarViewId) => {
      const panel = sidebarRef.current;
      const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
      if (collapsed) {
        panel?.resize(`${sidebarWidthRef.current}px`);
        if (id !== activeView) onSelectView(id);
        return;
      }
      if (id === activeView) {
        panel?.collapse();
        return;
      }
      onSelectView(id);
    },
    [activeView, onSelectView, sidebarRef, sidebarWidthRef],
  );

  if (enabledMeta.length === 0) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelTabStrip
        panels={descriptors}
        activeView={activeView}
        onSelectView={handleSelectView}
      />
      <div className="relative min-h-0 flex-1">
        {enabledMeta.map((m) => (
          <div
            key={m.id}
            className={cn(
              "absolute inset-0",
              activeView !== m.id && "invisible pointer-events-none",
            )}
            aria-hidden={activeView !== m.id}
          >
            {renderPanel(m.id, {
              explorerRef,
              explorerRoot,
              onOpenFile,
              onPathRenamed,
              onPathDeleted,
              onRevealInTerminal,
              onAttachToAgent,
              onOpenMarkdownPreview,
              sourceControl,
              onOpenDiff,
              onOpenGitGraph,
              tabs,
              activeTabId,
              onSelectTab,
              onCloseTab,
              onNewTab,
              activeEditorHandle,
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

type PanelContext = ExplorerProps &
  SourceControlProps &
  TabsProps & {
    activeEditorHandle: EditorPaneHandle | null;
  };

function renderPanel(id: SidebarViewId, ctx: PanelContext): React.ReactNode {
  switch (id) {
    case "explorer":
      return (
        <FileExplorer
          ref={ctx.explorerRef}
          rootPath={ctx.explorerRoot}
          onOpenFile={ctx.onOpenFile}
          onPathRenamed={ctx.onPathRenamed}
          onPathDeleted={ctx.onPathDeleted}
          onRevealInTerminal={ctx.onRevealInTerminal}
          onAttachToAgent={ctx.onAttachToAgent}
          onOpenMarkdownPreview={ctx.onOpenMarkdownPreview}
        />
      );
    case "source-control":
      return (
        <SourceControlPanel
          open
          sourceControl={ctx.sourceControl}
          onOpenDiff={ctx.onOpenDiff}
          onOpenGitGraph={ctx.onOpenGitGraph}
        />
      );
    case "tabs":
      return (
        <VerticalTabsPanel
          tabs={ctx.tabs}
          activeId={ctx.activeTabId}
          onSelect={ctx.onSelectTab}
          onClose={ctx.onCloseTab}
          onNew={ctx.onNewTab}
        />
      );
    case "search":
      return (
        <WorkspaceSearchPanel
          explorerRoot={ctx.explorerRoot}
          onOpenFile={ctx.onOpenFile}
        />
      );
    case "outline":
      return <OutlinePanel activeEditorHandle={ctx.activeEditorHandle} />;
    case "recent":
      return <RecentFilesPanel onOpenFile={ctx.onOpenFile} />;
  }
}
