// src/modules/sidebar/SidebarPanelHost.tsx
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  FolderGitTwoIcon,
  FolderTreeIcon,
  Clock01Icon,
  Search01Icon,
  ListViewIcon,
  GridViewIcon,
} from "@hugeicons/core-free-icons";
import type { RefObject } from "react";
import { useCallback, useEffect } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import {
  SourceControlPanel,
  type SourceControlSummary,
} from "@/modules/source-control";
import type { Tab } from "@/modules/tabs";
import type { EditorPaneHandle } from "@/modules/editor";
import { PanelTabStrip, type PanelDescriptor } from "./PanelTabStrip";
import type { SidebarViewId } from "./types";
import { VerticalTabsPanel } from "./panels/VerticalTabsPanel";
import { WorkspaceSearchPanel } from "./panels/WorkspaceSearchPanel";
import { OutlinePanel } from "./panels/OutlinePanel";
import { RecentFilesPanel } from "./panels/RecentFilesPanel";

type Props = {
  // view state
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
  sidebarRef: RefObject<PanelImperativeHandle | null>;
  sidebarWidthRef: RefObject<number>;
  // explorer
  explorerRef: RefObject<FileExplorerHandle | null>;
  explorerRoot: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed: (from: string, to: string) => void;
  onPathDeleted: (path: string) => void;
  onRevealInTerminal: (path: string) => void;
  onAttachToAgent: (path: string) => void;
  onOpenMarkdownPreview: (path: string) => void;
  // source control
  sourceControl: SourceControlSummary;
  onOpenDiff: (params: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    title?: string;
  }) => void;
  onOpenGitGraph: () => void;
  // vertical tabs
  tabs: Tab[];
  activeTabId: number;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  // outline
  activeEditorHandle: EditorPaneHandle | null;
};

const FULL_REGISTRY: {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof PanelTabStrip>[0]["panels"][number]["icon"];
  prefKey:
    | "sidebarPanelExplorer"
    | "sidebarPanelSourceControl"
    | "sidebarPanelTabs"
    | "sidebarPanelSearch"
    | "sidebarPanelOutline"
    | "sidebarPanelRecent";
}[] = [
  { id: "explorer", label: "Files", icon: FolderTreeIcon, prefKey: "sidebarPanelExplorer" },
  { id: "source-control", label: "Source Control", icon: FolderGitTwoIcon, prefKey: "sidebarPanelSourceControl" },
  { id: "tabs", label: "Tabs", icon: GridViewIcon, prefKey: "sidebarPanelTabs" },
  { id: "search", label: "Search", icon: Search01Icon, prefKey: "sidebarPanelSearch" },
  { id: "outline", label: "Outline", icon: ListViewIcon, prefKey: "sidebarPanelOutline" },
  { id: "recent", label: "Recent", icon: Clock01Icon, prefKey: "sidebarPanelRecent" },
];

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
  activeEditorHandle,
}: Props) {
  const prefs = usePreferencesStore((s) => ({
    explorer: s.sidebarPanelExplorer,
    sourceControl: s.sidebarPanelSourceControl,
    tabs: s.sidebarPanelTabs,
    search: s.sidebarPanelSearch,
    outline: s.sidebarPanelOutline,
    recent: s.sidebarPanelRecent,
  }));

  const prefMap: Record<SidebarViewId, boolean> = {
    explorer: prefs.explorer,
    "source-control": prefs.sourceControl,
    tabs: prefs.tabs,
    search: prefs.search,
    outline: prefs.outline,
    recent: prefs.recent,
  };

  const enabledPanels: PanelDescriptor[] = FULL_REGISTRY.filter(
    (p) => prefMap[p.id],
  ).map((p) => ({
    id: p.id,
    label: p.label,
    icon: p.icon,
    badge:
      p.id === "source-control" ? sourceControl.changedCount || undefined : undefined,
  }));

  // If the active view got disabled, fall back to the first enabled panel.
  useEffect(() => {
    if (enabledPanels.length === 0) return;
    if (!prefMap[activeView]) {
      onSelectView(enabledPanels[0].id);
    }
  }, [prefs]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectView = useCallback(
    (id: SidebarViewId) => {
      const panel = sidebarRef.current;
      const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
      if (collapsed) {
        if (panel) panel.resize(`${sidebarWidthRef.current}px`);
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

  if (enabledPanels.length === 0) return null;

  const panels: { id: SidebarViewId; content: React.ReactNode }[] = [
    {
      id: "explorer",
      content: (
        <FileExplorer
          ref={explorerRef}
          rootPath={explorerRoot}
          onOpenFile={onOpenFile}
          onPathRenamed={onPathRenamed}
          onPathDeleted={onPathDeleted}
          onRevealInTerminal={onRevealInTerminal}
          onAttachToAgent={onAttachToAgent}
          onOpenMarkdownPreview={onOpenMarkdownPreview}
        />
      ),
    },
    {
      id: "source-control",
      content: (
        <SourceControlPanel
          open
          sourceControl={sourceControl}
          onOpenDiff={onOpenDiff}
          onOpenGitGraph={onOpenGitGraph}
        />
      ),
    },
    {
      id: "tabs",
      content: (
        <VerticalTabsPanel
          tabs={tabs}
          activeId={activeTabId}
          onSelect={onSelectTab}
          onClose={onCloseTab}
        />
      ),
    },
    {
      id: "search",
      content: (
        <WorkspaceSearchPanel
          explorerRoot={explorerRoot}
          onOpenFile={onOpenFile}
        />
      ),
    },
    {
      id: "outline",
      content: <OutlinePanel activeEditorHandle={activeEditorHandle} />,
    },
    {
      id: "recent",
      content: <RecentFilesPanel onOpenFile={onOpenFile} />,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelTabStrip
        panels={enabledPanels}
        activeView={activeView}
        onSelectView={handleSelectView}
      />
      <div className="relative min-h-0 flex-1">
        {panels.map(({ id, content }) => (
          <div
            key={id}
            className={cn(
              "absolute inset-0",
              activeView !== id && "invisible pointer-events-none",
            )}
            aria-hidden={activeView !== id}
          >
            {content}
          </div>
        ))}
      </div>
    </div>
  );
}
