# Multi-Function Sidebar Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the two-view sidebar (Files / Source Control) into a six-panel multi-function tool with an icon-only tab strip at the top, per-panel enable/disable settings, and four new panels (Vertical Tabs, Workspace Search, Outline, Recent Files).

**Architecture:** A new `SidebarPanelHost` component replaces the inline sidebar block in `App.tsx`, owning the panel registry and icon tab strip (`PanelTabStrip`). Six boolean preferences gate which panels appear. The existing `FileExplorer` and `SourceControlPanel` are registered uniformly alongside four new panel components. When the Vertical Tabs panel is enabled, the horizontal `TabBar` in `Header` is hidden.

**Tech Stack:** React 19, TypeScript strict, Zustand, Tailwind v4, shadcn/ui, HugeIcons, `@tanstack/react-virtual`, CodeMirror 6 Lezer, `tauri-plugin-store`, `native.grep` Rust IPC.

**Spec:** `docs/superpowers/specs/2026-05-22-side-panel-design.md`

---

## File Map

**New files:**
- `src/modules/sidebar/PanelTabStrip.tsx` — icon-only tab bar rendered at the top of the sidebar
- `src/modules/sidebar/SidebarPanelHost.tsx` — replaces the inline sidebar block in App.tsx; owns the panel registry + layout
- `src/modules/sidebar/panels/VerticalTabsPanel.tsx` — vertical tab list
- `src/modules/sidebar/panels/WorkspaceSearchPanel.tsx` — grep-based find-in-files
- `src/modules/sidebar/panels/OutlinePanel.tsx` — Lezer symbol tree for active editor
- `src/modules/sidebar/panels/RecentFilesPanel.tsx` — recency list of opened files
- `src/modules/sidebar/recentFilesStore.ts` — Zustand store for recency list (persisted to localStorage)
- `src/settings/sections/PanelSection.tsx` — new settings section for enabling/disabling panels

**Modified files:**
- `src/modules/sidebar/types.ts` — expand `SidebarViewId` union
- `src/modules/sidebar/index.ts` — update barrel exports
- `src/modules/settings/store.ts` — add 6 pref keys + setters
- `src/modules/settings/preferences.ts` — add 6 fields + defaults
- `src/modules/editor/EditorPane.tsx` — add `getOutline()` and `goToLine()` to `EditorPaneHandle`
- `src/modules/header/Header.tsx` — accept `showTabBar: boolean` prop
- `src/app/App.tsx` — replace sidebar block with `<SidebarPanelHost>`, pass `showTabBar` to Header
- `src/settings/SettingsApp.tsx` — add "Panel" tab
- `src/modules/settings/openSettingsWindow.ts` — add `"panel"` to `SettingsTab` union

**Deleted files:**
- `src/modules/sidebar/SidebarRail.tsx` — replaced by `PanelTabStrip`

---

## Task 1: Foundation — types, preferences, store keys

**Files:**
- Modify: `src/modules/sidebar/types.ts`
- Modify: `src/modules/settings/store.ts`
- Modify: `src/modules/settings/preferences.ts`

- [ ] **Step 1.1: Expand `SidebarViewId`**

Replace the entire contents of `src/modules/sidebar/types.ts`:

```ts
export type SidebarViewId =
  | "explorer"
  | "source-control"
  | "tabs"
  | "search"
  | "outline"
  | "recent";
```

- [ ] **Step 1.2: Add pref keys to `store.ts`**

In `src/modules/settings/store.ts`, add these constant declarations after the existing `KEY_SHORTCUTS` line (around line 123):

```ts
const KEY_SIDEBAR_PANEL_EXPLORER = "sidebarPanelExplorer";
const KEY_SIDEBAR_PANEL_SOURCE_CONTROL = "sidebarPanelSourceControl";
const KEY_SIDEBAR_PANEL_TABS = "sidebarPanelTabs";
const KEY_SIDEBAR_PANEL_SEARCH = "sidebarPanelSearch";
const KEY_SIDEBAR_PANEL_OUTLINE = "sidebarPanelOutline";
const KEY_SIDEBAR_PANEL_RECENT = "sidebarPanelRecent";
```

- [ ] **Step 1.3: Add fields to `Preferences` type**

In `src/modules/settings/store.ts`, add these fields to the `Preferences` type (after `shortcuts`):

```ts
  sidebarPanelExplorer: boolean;
  sidebarPanelSourceControl: boolean;
  sidebarPanelTabs: boolean;
  sidebarPanelSearch: boolean;
  sidebarPanelOutline: boolean;
  sidebarPanelRecent: boolean;
```

- [ ] **Step 1.4: Add defaults to `DEFAULT_PREFERENCES`**

In `src/modules/settings/store.ts`, add to the `DEFAULT_PREFERENCES` object (after `shortcuts: {} as ...`):

```ts
  sidebarPanelExplorer: true,
  sidebarPanelSourceControl: true,
  sidebarPanelTabs: true,
  sidebarPanelSearch: false,
  sidebarPanelOutline: false,
  sidebarPanelRecent: false,
```

- [ ] **Step 1.5: Wire keys into `loadPreferences`**

In `src/modules/settings/store.ts`, inside `loadPreferences()`, add these lines after the `shortcuts:` line:

```ts
    sidebarPanelExplorer:
      get<boolean>(KEY_SIDEBAR_PANEL_EXPLORER) ?? DEFAULT_PREFERENCES.sidebarPanelExplorer,
    sidebarPanelSourceControl:
      get<boolean>(KEY_SIDEBAR_PANEL_SOURCE_CONTROL) ?? DEFAULT_PREFERENCES.sidebarPanelSourceControl,
    sidebarPanelTabs:
      get<boolean>(KEY_SIDEBAR_PANEL_TABS) ?? DEFAULT_PREFERENCES.sidebarPanelTabs,
    sidebarPanelSearch:
      get<boolean>(KEY_SIDEBAR_PANEL_SEARCH) ?? DEFAULT_PREFERENCES.sidebarPanelSearch,
    sidebarPanelOutline:
      get<boolean>(KEY_SIDEBAR_PANEL_OUTLINE) ?? DEFAULT_PREFERENCES.sidebarPanelOutline,
    sidebarPanelRecent:
      get<boolean>(KEY_SIDEBAR_PANEL_RECENT) ?? DEFAULT_PREFERENCES.sidebarPanelRecent,
```

- [ ] **Step 1.6: Add setter functions to `store.ts`**

Add these six setter functions to `src/modules/settings/store.ts` near the end of the file, before `onPreferencesChange`:

```ts
export async function setSidebarPanelExplorer(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_EXPLORER, value);
}
export async function setSidebarPanelSourceControl(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_SOURCE_CONTROL, value);
}
export async function setSidebarPanelTabs(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_TABS, value);
}
export async function setSidebarPanelSearch(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_SEARCH, value);
}
export async function setSidebarPanelOutline(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_OUTLINE, value);
}
export async function setSidebarPanelRecent(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_RECENT, value);
}
```

- [ ] **Step 1.7: Wire keys into `onPreferencesChange` map**

In `src/modules/settings/store.ts` inside `onPreferencesChange`, add to the `map` object:

```ts
    [KEY_SIDEBAR_PANEL_EXPLORER]: "sidebarPanelExplorer",
    [KEY_SIDEBAR_PANEL_SOURCE_CONTROL]: "sidebarPanelSourceControl",
    [KEY_SIDEBAR_PANEL_TABS]: "sidebarPanelTabs",
    [KEY_SIDEBAR_PANEL_SEARCH]: "sidebarPanelSearch",
    [KEY_SIDEBAR_PANEL_OUTLINE]: "sidebarPanelOutline",
    [KEY_SIDEBAR_PANEL_RECENT]: "sidebarPanelRecent",
```

- [ ] **Step 1.8: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 1.9: Commit**

```bash
git add src/modules/sidebar/types.ts src/modules/settings/store.ts src/modules/settings/preferences.ts
git commit -m "feat(sidebar): expand SidebarViewId and add panel enable/disable preferences"
```

---

## Task 2: `PanelTabStrip` component

**Files:**
- Create: `src/modules/sidebar/PanelTabStrip.tsx`

The icon-only tab strip rendered at the top of the sidebar. Replaces `SidebarRail`.

- [ ] **Step 2.1: Create `PanelTabStrip.tsx`**

```tsx
// src/modules/sidebar/PanelTabStrip.tsx
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

export type PanelDescriptor = {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  badge?: number;
};

type Props = {
  panels: PanelDescriptor[];
  activeView: SidebarViewId;
  onSelectView: (id: SidebarViewId) => void;
};

export const PANEL_TAB_STRIP_HEIGHT = 36;

export function PanelTabStrip({ panels, activeView, onSelectView }: Props) {
  if (panels.length === 0) return null;

  return (
    <div
      style={{ height: PANEL_TAB_STRIP_HEIGHT }}
      className="flex shrink-0 items-stretch gap-0.5 border-b border-border/60 bg-card/85 px-1.5 py-1 backdrop-blur"
    >
      {panels.map((panel) => {
        const isActive = panel.id === activeView;
        const showBadge = typeof panel.badge === "number" && panel.badge > 0;
        return (
          <Tooltip key={panel.id} delayDuration={400}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={panel.label}
                aria-pressed={isActive}
                onClick={() => onSelectView(panel.id)}
                className={cn(
                  "group relative flex h-full w-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors duration-150",
                  "focus-visible:ring-2 focus-visible:ring-primary/40",
                  isActive
                    ? "bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.09]"
                    : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={panel.icon}
                  size={15}
                  strokeWidth={isActive ? 2 : 1.75}
                  className="shrink-0 transition-[stroke-width] duration-150"
                />
                {showBadge ? (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/70 px-0.5 text-[8px] font-semibold leading-none tabular-nums text-background">
                    {panel.badge! > 99 ? "99+" : panel.badge}
                  </span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {panel.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2.2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/modules/sidebar/PanelTabStrip.tsx
git commit -m "feat(sidebar): add PanelTabStrip icon-only tab bar"
```

---

## Task 3: `SidebarPanelHost` component

**Files:**
- Create: `src/modules/sidebar/SidebarPanelHost.tsx`
- Modify: `src/modules/sidebar/index.ts`
- Delete: `src/modules/sidebar/SidebarRail.tsx` (after wiring is complete in Task 4)

This component owns the full sidebar interior: tab strip at top, active panel content below. Panel content is rendered with the `invisible pointer-events-none` / absolute pattern so panels preserve state when hidden.

- [ ] **Step 3.1: Create placeholder panel components (stubs)**

These stubs let `SidebarPanelHost` compile before the real implementations in Tasks 5–8. Create `src/modules/sidebar/panels/VerticalTabsPanel.tsx`:

```tsx
// src/modules/sidebar/panels/VerticalTabsPanel.tsx
export type VerticalTabsPanelProps = {
  tabs: import("@/modules/tabs").Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
};
export function VerticalTabsPanel(_props: VerticalTabsPanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Vertical Tabs — coming soon</div>;
}
```

Create `src/modules/sidebar/panels/WorkspaceSearchPanel.tsx`:

```tsx
// src/modules/sidebar/panels/WorkspaceSearchPanel.tsx
export type WorkspaceSearchPanelProps = {
  explorerRoot: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
};
export function WorkspaceSearchPanel(_props: WorkspaceSearchPanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Search — coming soon</div>;
}
```

Create `src/modules/sidebar/panels/OutlinePanel.tsx`:

```tsx
// src/modules/sidebar/panels/OutlinePanel.tsx
import type { EditorPaneHandle } from "@/modules/editor";
export type OutlinePanelProps = {
  activeEditorHandle: EditorPaneHandle | null;
};
export function OutlinePanel(_props: OutlinePanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Outline — coming soon</div>;
}
```

Create `src/modules/sidebar/panels/RecentFilesPanel.tsx`:

```tsx
// src/modules/sidebar/panels/RecentFilesPanel.tsx
export type RecentFilesPanelProps = {
  onOpenFile: (path: string, pin?: boolean) => void;
};
export function RecentFilesPanel(_props: RecentFilesPanelProps) {
  return <div className="p-3 text-[11px] text-muted-foreground">Recent Files — coming soon</div>;
}
```

- [ ] **Step 3.2: Create `SidebarPanelHost.tsx`**

```tsx
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
```

- [ ] **Step 3.3: Update barrel exports**

Replace the contents of `src/modules/sidebar/index.ts`:

```ts
export { SidebarPanelHost } from "./SidebarPanelHost";
export { PANEL_TAB_STRIP_HEIGHT } from "./PanelTabStrip";
export type { SidebarViewId } from "./types";
```

- [ ] **Step 3.4: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors. The `SourceControlPanel` `onOpenDiff` prop type must match — check `src/modules/source-control/SourceControlPanel.tsx` if there's a type mismatch and update the `Props` type in `SidebarPanelHost` accordingly.

- [ ] **Step 3.5: Commit**

```bash
git add src/modules/sidebar/
git commit -m "feat(sidebar): add SidebarPanelHost and panel stub components"
```

---

## Task 4: Wire `SidebarPanelHost` into `App.tsx` and update `Header`

**Files:**
- Modify: `src/modules/header/Header.tsx`
- Modify: `src/app/App.tsx`
- Delete: `src/modules/sidebar/SidebarRail.tsx`

- [ ] **Step 4.1: Add `showTabBar` prop to `Header`**

In `src/modules/header/Header.tsx`, add `showTabBar: boolean` to the `Props` type:

```ts
type Props = {
  // ... existing props ...
  showTabBar: boolean;
};
```

Add `showTabBar` to the destructured params in the `Header` function signature:

```ts
export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onClose,
  onPin,
  onToggleSidebar,
  onSplit,
  canSplit,
  onOpenShortcuts,
  onOpenSettings,
  searchTarget,
  searchRef,
  showTabBar,          // ← add
}: Props) {
```

Find the `<TabBar ... />` block (around line 205) and wrap it so it only renders when `showTabBar` is true. The surrounding `div` that contains the `TabBar` and the drag-region spacer should be conditionally rendered:

```tsx
      {showTabBar ? (
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
            onNewGitGraph={onNewGitGraph}
            onClose={onClose}
            onPin={onPin}
            compact={compact}
          />
          <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
        </div>
      ) : (
        <div
          className="h-full min-w-2 flex-1"
          data-tauri-drag-region
        />
      )}
```

- [ ] **Step 4.2: Replace the sidebar block in `App.tsx`**

In `src/app/App.tsx`, add the import for `SidebarPanelHost`:

```ts
import { SidebarPanelHost, type SidebarViewId } from "@/modules/sidebar";
```

Remove the import of `SidebarRail` and `SIDEBAR_RAIL_HEIGHT` (they no longer exist).

Read `sidebarPanelTabs` from the prefs store. Add this near the other pref reads (around line 382):

```ts
  const sidebarPanelTabs = usePreferencesStore((s) => s.sidebarPanelTabs);
```

Find the sidebar `ResizablePanel` children block (around line 1324). Replace:

```tsx
                <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
                  <div className="min-h-0 flex-1">
                    {sidebarView === "explorer" ? (
                      <FileExplorer
                        ref={explorerRef}
                        rootPath={explorerRoot}
                        onOpenFile={handleOpenFile}
                        onPathRenamed={handlePathRenamed}
                        onPathDeleted={handlePathDeleted}
                        onRevealInTerminal={cdInNewTab}
                        onAttachToAgent={handleAttachFileToAgent}
                        onOpenMarkdownPreview={openMarkdownPreview}
                      />
                    ) : (
                      <SourceControlPanel
                        open
                        sourceControl={sourceControl}
                        onOpenDiff={openGitDiffTab}
                        onOpenGitGraph={openGitGraphFromContext}
                      />
                    )}
                  </div>
                  <SidebarRail
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    changedCount={sourceControl.changedCount}
                  />
                </div>
```

With:

```tsx
                <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
                  <SidebarPanelHost
                    activeView={sidebarView}
                    onSelectView={persistSidebarView}
                    sidebarRef={sidebarRef}
                    sidebarWidthRef={sidebarWidthRef}
                    explorerRef={explorerRef}
                    explorerRoot={explorerRoot}
                    onOpenFile={handleOpenFile}
                    onPathRenamed={handlePathRenamed}
                    onPathDeleted={handlePathDeleted}
                    onRevealInTerminal={cdInNewTab}
                    onAttachToAgent={handleAttachFileToAgent}
                    onOpenMarkdownPreview={openMarkdownPreview}
                    sourceControl={sourceControl}
                    onOpenDiff={openGitDiffTab}
                    onOpenGitGraph={openGitGraphFromContext}
                    tabs={tabs}
                    activeTabId={activeId}
                    onSelectTab={setActiveId}
                    onCloseTab={handleClose}
                    activeEditorHandle={activeEditorHandle}
                  />
                </div>
```

- [ ] **Step 4.3: Remove `cycleSidebarView` from `App.tsx`**

`SidebarPanelHost` now owns collapse/expand logic internally, so `cycleSidebarView` in `App.tsx` is no longer needed. Remove the `cycleSidebarView` callback and all its usages (the `toggleSourceControl` callback now just calls `persistSidebarView("source-control")` after checking if the sidebar is open). Update `toggleSourceControl`:

```ts
  const toggleSourceControl = useCallback(() => {
    const panel = sidebarRef.current;
    const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
    if (collapsed) {
      if (panel) panel.resize(`${sidebarWidthRef.current}px`);
      persistSidebarView("source-control");
    } else if (sidebarView === "source-control") {
      panel?.collapse();
    } else {
      persistSidebarView("source-control");
    }
  }, [sidebarView, persistSidebarView, sidebarRef, sidebarWidthRef]);
```

- [ ] **Step 4.4: Pass `showTabBar` to `<Header>`**

Find the `<Header>` JSX in `App.tsx` and add the prop:

```tsx
            <Header
              ...existing props...
              showTabBar={!sidebarPanelTabs}
            />
```

- [ ] **Step 4.5: Remove `FileExplorer` and `SourceControlPanel` imports from App.tsx**

They are now rendered inside `SidebarPanelHost`. Remove these imports from `App.tsx`:

```ts
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
// ↑ keep FileExplorerHandle if used elsewhere; remove FileExplorer
import {
  SourceControlPanel,
  useSourceControl,
} from "@/modules/source-control";
// ↑ keep useSourceControl (still called here); remove SourceControlPanel
```

- [ ] **Step 4.6: Delete `SidebarRail.tsx`**

```bash
git rm src/modules/sidebar/SidebarRail.tsx
```

- [ ] **Step 4.7: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.8: Smoke-test in dev**

```bash
pnpm tauri dev
```

Verify:
- The sidebar opens with the icon strip at the top (Files, Source Control, Tabs visible by default)
- Clicking each icon switches the panel
- Clicking the active icon collapses the sidebar
- The Files and Source Control panels render correctly (stubs show for Tabs)
- When Tabs panel is active, the horizontal tab bar is hidden

- [ ] **Step 4.9: Commit**

```bash
git add src/app/App.tsx src/modules/header/Header.tsx src/modules/sidebar/
git commit -m "feat(sidebar): wire SidebarPanelHost into App, hide horizontal TabBar when Tabs panel enabled"
```

---

## Task 5: `VerticalTabsPanel`

**Files:**
- Modify: `src/modules/sidebar/panels/VerticalTabsPanel.tsx`

Replace the stub with the real implementation. Uses `@tanstack/react-virtual` for virtualisation.

- [ ] **Step 5.1: Implement `VerticalTabsPanel`**

```tsx
// src/modules/sidebar/panels/VerticalTabsPanel.tsx
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import type { Tab } from "@/modules/tabs";
import {
  Cancel01Icon,
  ComputerTerminal02Icon,
  GitBranchIcon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

export type VerticalTabsPanelProps = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
};

function tabIcon(tab: Tab): React.ReactNode {
  if (tab.kind === "terminal") {
    return tab.private ? (
      <HugeiconsIcon icon={IncognitoIcon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
    ) : (
      <HugeiconsIcon icon={ComputerTerminal02Icon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
    );
  }
  if (tab.kind === "editor") {
    const url = fileIconUrl(tab.path);
    if (url) return <img src={url} alt="" className="h-3.5 w-3.5 shrink-0" />;
    return <HugeiconsIcon icon={PencilEdit02Icon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  if (tab.kind === "preview" || tab.kind === "markdown") {
    return <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file" || tab.kind === "ai-diff") {
    return <HugeiconsIcon icon={GitCompareIcon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  if (tab.kind === "git-history") {
    return <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  return null;
}

export function VerticalTabsPanel({ tabs, activeId, onSelect, onClose }: VerticalTabsPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: tabs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-full overflow-y-auto py-1">
      <div
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}
      >
        {rowVirtualizer.getVirtualItems().map((vItem) => {
          const tab = tabs[vItem.index];
          if (!tab) return null;
          const isActive = tab.id === activeId;
          const isDirty = tab.kind === "editor" && tab.dirty;

          return (
            <div
              key={tab.id}
              data-index={vItem.index}
              ref={rowVirtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vItem.start}px)` }}
              className={cn(
                "group flex h-8 cursor-pointer items-center gap-1.5 px-2 text-[11.5px] select-none",
                isActive
                  ? "bg-foreground/[0.07] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
              )}
              onClick={() => onSelect(tab.id)}
            >
              {tabIcon(tab)}
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              {isDirty && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50" />
              )}
              <button
                type="button"
                aria-label="Close tab"
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="invisible shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground group-hover:visible"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.3: Smoke-test in dev**

Run `pnpm tauri dev`. Enable the Tabs panel (default on). Switch to the Tabs panel view and verify: all open tabs are listed, clicking a tab switches to it, close button appears on hover.

- [ ] **Step 5.4: Commit**

```bash
git add src/modules/sidebar/panels/VerticalTabsPanel.tsx
git commit -m "feat(sidebar): implement VerticalTabsPanel"
```

---

## Task 6: `WorkspaceSearchPanel`

**Files:**
- Modify: `src/modules/sidebar/panels/WorkspaceSearchPanel.tsx`

Uses `native.grep` (already used by AI tools). Debounced at 300 ms. Results grouped by file.

- [ ] **Step 6.1: Implement `WorkspaceSearchPanel`**

```tsx
// src/modules/sidebar/panels/WorkspaceSearchPanel.tsx
import { cn } from "@/lib/utils";
import { native } from "@/modules/ai/lib/native";
import type { GrepHit } from "@/modules/ai/lib/native";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

export type WorkspaceSearchPanelProps = {
  explorerRoot: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
};

type GroupedResult = {
  rel: string;
  path: string;
  hits: GrepHit[];
};

function groupByFile(hits: GrepHit[]): GroupedResult[] {
  const map = new Map<string, GroupedResult>();
  for (const hit of hits) {
    const existing = map.get(hit.path);
    if (existing) {
      existing.hits.push(hit);
    } else {
      map.set(hit.path, { rel: hit.rel, path: hit.path, hits: [hit] });
    }
  }
  return Array.from(map.values());
}

export function WorkspaceSearchPanel({ explorerRoot, onOpenFile }: WorkspaceSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupedResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || !explorerRoot) {
        setResults([]);
        setTruncated(false);
        return;
      }
      setSearching(true);
      try {
        const res = await native.grep({
          pattern: q,
          root: explorerRoot,
          caseInsensitive: true,
          maxResults: 200,
        });
        setResults(groupByFile(res.hits));
        setTruncated(res.truncated);
      } catch {
        setResults([]);
        setTruncated(false);
      } finally {
        setSearching(false);
      }
    },
    [explorerRoot],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1">
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="min-w-0 flex-1 bg-transparent text-[11.5px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!query.trim() && (
          <p className="p-3 text-[11px] text-muted-foreground">Type to search across files.</p>
        )}
        {query.trim() && !searching && results.length === 0 && (
          <p className="p-3 text-[11px] text-muted-foreground">No matches found.</p>
        )}
        {results.map((group) => {
          const iconUrl = fileIconUrl(group.path);
          const filename = group.rel.split(/[\\/]/).pop() ?? group.rel;
          const dir = group.rel.includes("/") || group.rel.includes("\\")
            ? group.rel.slice(0, group.rel.lastIndexOf(group.rel.includes("/") ? "/" : "\\"))
            : "";
          return (
            <div key={group.path} className="border-b border-border/40 last:border-0">
              <div className="flex items-center gap-1.5 px-2 py-1">
                {iconUrl ? (
                  <img src={iconUrl} alt="" className="h-3 w-3 shrink-0" />
                ) : null}
                <span className="text-[11px] font-medium text-foreground truncate">{filename}</span>
                {dir ? (
                  <span className="min-w-0 truncate text-[10px] text-muted-foreground/70">{dir}</span>
                ) : null}
              </div>
              {group.hits.map((hit, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpenFile(hit.path, true)}
                  className="flex w-full items-baseline gap-1.5 px-3 py-0.5 text-left hover:bg-foreground/[0.04]"
                >
                  <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">
                    {hit.line}
                  </span>
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {hit.text.trim()}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
        {truncated && (
          <p className="p-2 text-[10px] text-muted-foreground/70 text-center">
            Results truncated — refine your query.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.2: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.3: Smoke-test in dev**

Enable the Search panel in Settings → Panel. Switch to the Search panel and type a term. Verify results appear grouped by file. Click a match and verify the file opens.

- [ ] **Step 6.4: Commit**

```bash
git add src/modules/sidebar/panels/WorkspaceSearchPanel.tsx
git commit -m "feat(sidebar): implement WorkspaceSearchPanel using native grep"
```

---

## Task 7: `OutlinePanel` + `EditorPaneHandle` extensions

**Files:**
- Modify: `src/modules/editor/EditorPane.tsx`
- Modify: `src/modules/sidebar/panels/OutlinePanel.tsx`

Add `getOutline()` and `goToLine()` to `EditorPaneHandle`, then implement the Outline panel using Lezer tree walking.

- [ ] **Step 7.1: Write a failing test for Lezer outline extraction**

Create `src/modules/sidebar/panels/outline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractOutline } from "./outlineExtractor";

describe("extractOutline — TypeScript", () => {
  it("extracts top-level function declarations", () => {
    const src = `function hello() {}\nfunction world() {}`;
    const nodes = extractOutline(src, "ts");
    expect(nodes.map((n) => n.label)).toEqual(["hello", "world"]);
    expect(nodes.map((n) => n.kind)).toEqual(["function", "function"]);
  });

  it("extracts class declarations", () => {
    const src = `class Foo {}\nclass Bar {}`;
    const nodes = extractOutline(src, "ts");
    expect(nodes.map((n) => n.label)).toEqual(["Foo", "Bar"]);
    expect(nodes.map((n) => n.kind)).toEqual(["class", "class"]);
  });
});

describe("extractOutline — Markdown", () => {
  it("extracts headings with depth", () => {
    const src = `# H1\n## H2\n### H3`;
    const nodes = extractOutline(src, "md");
    expect(nodes.map((n) => n.label)).toEqual(["H1", "H2", "H3"]);
    expect(nodes.map((n) => n.depth)).toEqual([1, 2, 3]);
  });
});

describe("extractOutline — unsupported language", () => {
  it("returns empty array", () => {
    const nodes = extractOutline("any code", "txt");
    expect(nodes).toEqual([]);
  });
});
```

- [ ] **Step 7.2: Run test to confirm it fails**

```bash
pnpm exec vitest run src/modules/sidebar/panels/outline.test.ts
```

Expected: FAIL — `extractOutline` not found.

- [ ] **Step 7.3: Create `outlineExtractor.ts`**

Create `src/modules/sidebar/panels/outlineExtractor.ts`:

```ts
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { go } from "@codemirror/lang-go";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export type OutlineNode = {
  label: string;
  kind: "function" | "class" | "variable" | "heading" | "other";
  line: number;
  depth: number;
};

// Maps file extension → grammar factory
const EXT_TO_GRAMMAR: Record<string, () => import("@codemirror/state").Extension> = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  py: () => python(),
  rs: () => rust(),
  go: () => go(),
  md: () => markdown(),
  mdx: () => markdown(),
};

function grammarFor(ext: string): (() => import("@codemirror/state").Extension) | null {
  return EXT_TO_GRAMMAR[ext.toLowerCase()] ?? null;
}

// Node type names to treat as declarations
const JS_FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
  "MethodDefinition",
]);
const JS_CLASS_TYPES = new Set(["ClassDeclaration", "ClassExpression"]);
const PYTHON_FUNCTION_TYPES = new Set(["FunctionDefinition"]);
const PYTHON_CLASS_TYPES = new Set(["ClassDefinition"]);
const RUST_FUNCTION_TYPES = new Set(["FunctionItem"]);
const RUST_TYPE_TYPES = new Set(["StructItem", "EnumItem", "ImplItem"]);
const GO_FUNCTION_TYPES = new Set(["FunctionDecl", "MethodDecl"]);
const GO_TYPE_TYPES = new Set(["TypeDecl"]);

function lineAt(state: EditorState, pos: number): number {
  return state.doc.lineAt(pos).number;
}

function nameFromNode(
  state: EditorState,
  node: import("@lezer/common").SyntaxNode,
): string | null {
  const nameNode = node.getChild("VariableDefinition") ?? node.getChild("TypeDefinition") ?? node.getChild("PropertyDefinition");
  if (nameNode) return state.doc.sliceString(nameNode.from, nameNode.to);
  // For Python/Rust/Go, the name is often the first Identifier child
  const ident = node.getChild("Identifier");
  if (ident) return state.doc.sliceString(ident.from, ident.to);
  return null;
}

export function extractOutline(source: string, ext: string): OutlineNode[] {
  const grammar = grammarFor(ext);
  if (!grammar) return [];

  const state = EditorState.create({ doc: source, extensions: [grammar()] });
  const parsed = syntaxTree(state);
  const nodes: OutlineNode[] = [];

  const isMarkdown = ext === "md" || ext === "mdx";
  const isJS = ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx";
  const isPython = ext === "py";
  const isRust = ext === "rs";
  const isGo = ext === "go";

  if (isMarkdown) {
    parsed.cursor().iterate((node) => {
      if (!node.name.startsWith("ATXHeading")) return;
      const level = parseInt(node.name.replace("ATXHeading", ""), 10);
      if (!Number.isFinite(level)) return;
      const markEnd = node.node.firstChild?.to ?? node.from;
      const text = state.doc.sliceString(markEnd, node.to).trim();
      nodes.push({ label: text, kind: "heading", line: lineAt(state, node.from), depth: level });
    });
    return nodes;
  }

  parsed.cursor().iterate((node) => {
    if (isJS) {
      if (JS_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (JS_CLASS_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (isPython) {
      if (PYTHON_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (PYTHON_CLASS_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (isRust) {
      if (RUST_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (RUST_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (isGo) {
      if (GO_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (GO_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    }
  });

  return nodes;
}
```

**Note on Lezer node names:** The exact node type names depend on the Lezer grammar version. If tests fail due to wrong node names, run `pnpm exec vitest run` and inspect the tree by adding a temporary `parsed.cursor().iterate((n) => console.log(n.name))` call. Adjust the `*_TYPES` sets accordingly.

- [ ] **Step 7.4: Run tests**

```bash
pnpm exec vitest run src/modules/sidebar/panels/outline.test.ts
```

Expected: all tests pass. If node name mismatches cause failures, add a debug iterate and adjust the `*_TYPES` sets until they pass:

```ts
parsed.cursor().iterate((node) => console.log(node.name, node.from, node.to));
```

- [ ] **Step 7.5: Add `getOutline` and `goToLine` to `EditorPaneHandle`**

In `src/modules/editor/EditorPane.tsx`, update the `EditorPaneHandle` type (find the existing type and append the two new methods):

```ts
export type EditorPaneHandle = {
  setQuery: (q: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  reload: () => boolean;
  undo: () => void;
  redo: () => void;
  /** Returns the symbol outline for the current document. Empty array for unsupported languages. */
  getOutline: () => import("@/modules/sidebar/panels/outlineExtractor").OutlineNode[];
  /** Scrolls the editor to the given 1-based line number. */
  goToLine: (line: number) => void;
};
```

Add a static import at the top of `EditorPane.tsx`:

```ts
import { extractOutline } from "@/modules/sidebar/panels/outlineExtractor";
```

Add `EditorView` to the existing `@codemirror/view` import:

```ts
import { ..., EditorView } from "@codemirror/view";
```

Inside the `useImperativeHandle` block, add the two new methods:

```ts
    getOutline: () => {
      const view = cmRef.current?.view;
      if (!view) return [];
      const doc = view.state.doc.toString();
      const ext = pathRef.current.split(".").pop()?.toLowerCase() ?? "";
      return extractOutline(doc, ext);
    },
    goToLine: (line: number) => {
      const view = cmRef.current?.view;
      if (!view) return;
      const lineInfo = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
      view.dispatch({
        selection: { anchor: lineInfo.from },
        effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
      });
      view.focus();
    },
```

- [ ] **Step 7.6: Implement `OutlinePanel`**

```tsx
// src/modules/sidebar/panels/OutlinePanel.tsx
import { cn } from "@/lib/utils";
import type { EditorPaneHandle } from "@/modules/editor";
import type { OutlineNode } from "./outlineExtractor";
import {
  Code01Icon,
  Layers01Icon,
  TextSquareIcon,
  Menu01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

export type OutlinePanelProps = {
  activeEditorHandle: EditorPaneHandle | null;
};

const KIND_ICONS = {
  function: Code01Icon,
  class: Layers01Icon,
  variable: TextSquareIcon,
  heading: Menu01Icon,
  other: Menu01Icon,
} as const;

export function OutlinePanel({ activeEditorHandle }: OutlinePanelProps) {
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeEditorHandle) {
      setNodes([]);
      return;
    }
    const refresh = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setNodes(activeEditorHandle.getOutline());
      }, 300);
    };
    refresh();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeEditorHandle]);

  if (!activeEditorHandle) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        Open a file to see its outline.
      </p>
    );
  }

  if (nodes.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        No outline available for this file type.
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-1">
      {nodes.map((node, i) => {
        const Icon = KIND_ICONS[node.kind];
        return (
          <button
            key={i}
            type="button"
            onClick={() => activeEditorHandle.goToLine(node.line)}
            style={{ paddingLeft: `${8 + (node.depth - 1) * 12}px` }}
            className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[11.5px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <HugeiconsIcon icon={Icon} size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="min-w-0 truncate">{node.label}</span>
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
              {node.line}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7.7: Type-check and run tests**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/modules/sidebar/panels/outline.test.ts
```

Expected: no type errors, all outline tests pass.

- [ ] **Step 7.8: Commit**

```bash
git add src/modules/editor/EditorPane.tsx \
        src/modules/sidebar/panels/OutlinePanel.tsx \
        src/modules/sidebar/panels/outlineExtractor.ts \
        src/modules/sidebar/panels/outline.test.ts
git commit -m "feat(sidebar): implement OutlinePanel with Lezer symbol extraction"
```

---

## Task 8: `RecentFilesPanel` and `recentFilesStore`

**Files:**
- Create: `src/modules/sidebar/recentFilesStore.ts`
- Modify: `src/modules/sidebar/panels/RecentFilesPanel.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 8.1: Write a failing test for `recentFilesStore`**

Create `src/modules/sidebar/recentFilesStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useRecentFilesStore } from "./recentFilesStore";

beforeEach(() => {
  useRecentFilesStore.setState({ paths: [] });
});

describe("recentFilesStore", () => {
  it("pushes a new path to the front", () => {
    useRecentFilesStore.getState().push("/a/b.ts");
    expect(useRecentFilesStore.getState().paths[0]).toBe("/a/b.ts");
  });

  it("deduplicates: re-pushed path moves to front", () => {
    useRecentFilesStore.getState().push("/a/b.ts");
    useRecentFilesStore.getState().push("/a/c.ts");
    useRecentFilesStore.getState().push("/a/b.ts");
    expect(useRecentFilesStore.getState().paths).toEqual(["/a/b.ts", "/a/c.ts"]);
  });

  it("caps at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      useRecentFilesStore.getState().push(`/file${i}.ts`);
    }
    expect(useRecentFilesStore.getState().paths.length).toBe(50);
  });

  it("clear empties the list", () => {
    useRecentFilesStore.getState().push("/a.ts");
    useRecentFilesStore.getState().clear();
    expect(useRecentFilesStore.getState().paths).toEqual([]);
  });
});
```

- [ ] **Step 8.2: Run test to confirm failure**

```bash
pnpm exec vitest run src/modules/sidebar/recentFilesStore.test.ts
```

Expected: FAIL — `recentFilesStore` not found.

- [ ] **Step 8.3: Implement `recentFilesStore.ts`**

```ts
// src/modules/sidebar/recentFilesStore.ts
import { create } from "zustand";

const STORAGE_KEY = "terax.recent-files";
const MAX_ENTRIES = 50;

function readFromStorage(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function writeToStorage(paths: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // ignore
  }
}

type State = {
  paths: string[];
  push: (path: string) => void;
  clear: () => void;
};

export const useRecentFilesStore = create<State>((set) => ({
  paths: typeof window !== "undefined" ? readFromStorage() : [],
  push: (path) =>
    set((s) => {
      const without = s.paths.filter((p) => p !== path);
      const next = [path, ...without].slice(0, MAX_ENTRIES);
      writeToStorage(next);
      return { paths: next };
    }),
  clear: () =>
    set(() => {
      writeToStorage([]);
      return { paths: [] };
    }),
}));
```

- [ ] **Step 8.4: Run tests**

```bash
pnpm exec vitest run src/modules/sidebar/recentFilesStore.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 8.5: Implement `RecentFilesPanel`**

```tsx
// src/modules/sidebar/panels/RecentFilesPanel.tsx
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { useRecentFilesStore } from "../recentFilesStore";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export type RecentFilesPanelProps = {
  onOpenFile: (path: string, pin?: boolean) => void;
};

export function RecentFilesPanel({ onOpenFile }: RecentFilesPanelProps) {
  const paths = useRecentFilesStore((s) => s.paths);
  const clear = useRecentFilesStore((s) => s.clear);

  if (paths.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        No recently opened files.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {paths.map((path) => {
          const parts = path.split(/[\\/]/);
          const filename = parts[parts.length - 1] ?? path;
          const dir = parts.slice(0, -1).join("/");
          const iconUrl = fileIconUrl(path);
          return (
            <button
              key={path}
              type="button"
              onClick={() => onOpenFile(path, true)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-foreground/[0.04]"
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" className="h-3.5 w-3.5 shrink-0" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] text-foreground">{filename}</div>
                <div className="truncate text-[10px] text-muted-foreground/60">{dir}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-border/60 p-1.5">
        <button
          type="button"
          onClick={clear}
          className="flex w-full items-center justify-center gap-1 rounded-md py-1 text-[11px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
          Clear
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.6: Wire `push` into `openFileTab` in `App.tsx`**

In `src/app/App.tsx`, import the store:

```ts
import { useRecentFilesStore } from "@/modules/sidebar/recentFilesStore";
```

Find the `handleOpenFile` callback in `App.tsx` and update it to push to the recent store:

```ts
  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      openFileTab(path, pin ?? false);
      useRecentFilesStore.getState().push(path);
    },
    [openFileTab],
  );
```

- [ ] **Step 8.7: Type-check and run tests**

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/modules/sidebar/recentFilesStore.test.ts
```

Expected: no errors.

- [ ] **Step 8.8: Commit**

```bash
git add src/modules/sidebar/recentFilesStore.ts \
        src/modules/sidebar/recentFilesStore.test.ts \
        src/modules/sidebar/panels/RecentFilesPanel.tsx \
        src/app/App.tsx
git commit -m "feat(sidebar): implement RecentFilesPanel and recentFilesStore"
```

---

## Task 9: Panel Settings section

**Files:**
- Create: `src/settings/sections/PanelSection.tsx`
- Modify: `src/modules/settings/openSettingsWindow.ts`
- Modify: `src/settings/SettingsApp.tsx`

- [ ] **Step 9.1: Create `PanelSection.tsx`**

```tsx
// src/settings/sections/PanelSection.tsx
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setSidebarPanelExplorer,
  setSidebarPanelOutline,
  setSidebarPanelRecent,
  setSidebarPanelSearch,
  setSidebarPanelSourceControl,
  setSidebarPanelTabs,
} from "@/modules/settings/store";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

type PanelDef = {
  title: string;
  description: string;
  prefKey:
    | "sidebarPanelExplorer"
    | "sidebarPanelSourceControl"
    | "sidebarPanelTabs"
    | "sidebarPanelSearch"
    | "sidebarPanelOutline"
    | "sidebarPanelRecent";
  setter: (v: boolean) => Promise<void>;
};

const PANELS: PanelDef[] = [
  {
    title: "Files",
    description: "File tree and project explorer.",
    prefKey: "sidebarPanelExplorer",
    setter: setSidebarPanelExplorer,
  },
  {
    title: "Source Control",
    description: "Git status, stage changes, and commit.",
    prefKey: "sidebarPanelSourceControl",
    setter: setSidebarPanelSourceControl,
  },
  {
    title: "Tabs",
    description: "Vertical tab list. Hides the top tab bar while enabled.",
    prefKey: "sidebarPanelTabs",
    setter: setSidebarPanelTabs,
  },
  {
    title: "Search",
    description: "Find in files across the workspace.",
    prefKey: "sidebarPanelSearch",
    setter: setSidebarPanelSearch,
  },
  {
    title: "Outline",
    description: "Symbol tree for the active editor file (functions, classes, headings).",
    prefKey: "sidebarPanelOutline",
    setter: setSidebarPanelOutline,
  },
  {
    title: "Recent Files",
    description: "Quick access to recently opened files.",
    prefKey: "sidebarPanelRecent",
    setter: setSidebarPanelRecent,
  },
];

export function PanelSection() {
  const prefs = usePreferencesStore((s) => ({
    sidebarPanelExplorer: s.sidebarPanelExplorer,
    sidebarPanelSourceControl: s.sidebarPanelSourceControl,
    sidebarPanelTabs: s.sidebarPanelTabs,
    sidebarPanelSearch: s.sidebarPanelSearch,
    sidebarPanelOutline: s.sidebarPanelOutline,
    sidebarPanelRecent: s.sidebarPanelRecent,
  }));

  const enabledCount = Object.values(prefs).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Panel"
        description="Choose which tools appear in the sidebar."
      />
      <div className="flex flex-col gap-2">
        {PANELS.map((panel) => {
          const isEnabled = prefs[panel.prefKey];
          const isLastEnabled = enabledCount === 1 && isEnabled;
          return (
            <Tooltip key={panel.prefKey} delayDuration={400}>
              <TooltipTrigger asChild>
                <div>
                  <SettingRow title={panel.title} description={panel.description}>
                    <Switch
                      checked={isEnabled}
                      disabled={isLastEnabled}
                      onCheckedChange={(v) => void panel.setter(v)}
                    />
                  </SettingRow>
                </div>
              </TooltipTrigger>
              {isLastEnabled ? (
                <TooltipContent side="left" className="text-[11px]">
                  At least one panel must remain enabled.
                </TooltipContent>
              ) : null}
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.2: Add `"panel"` to `SettingsTab` union**

In `src/modules/settings/openSettingsWindow.ts`:

```ts
export type SettingsTab =
  | "general"
  | "themes"
  | "shortcuts"
  | "panel"
  | "models"
  | "agents"
  | "about";
```

- [ ] **Step 9.3: Register the Panel tab in `SettingsApp.tsx`**

In `src/settings/SettingsApp.tsx`, add the import:

```ts
import { LayoutTableColumnsIcon } from "@hugeicons/core-free-icons";
import { PanelSection } from "./sections/PanelSection";
```

Add the tab entry to the `TABS` array after `"shortcuts"`:

```ts
    { id: "panel", label: "Panel", icon: LayoutTableColumnsIcon, component: PanelSection },
```

Add `"panel"` to the `VALID_TABS` array:

```ts
const VALID_TABS: SettingsTab[] = [
  "general",
  "themes",
  "shortcuts",
  "panel",
  "models",
  "agents",
  "about",
];
```

Update the back-compat check in `readInitialTab` to include the new type-guard:

```ts
  if (t && (VALID_TABS as string[]).includes(t)) return t as SettingsTab;
```

(No change needed — it already handles this generically.)

- [ ] **Step 9.4: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9.5: Smoke-test in dev**

```bash
pnpm tauri dev
```

Open Settings. Verify "Panel" tab appears between Shortcuts and Models. Toggle Search on — verify the Search icon appears in the sidebar strip. Toggle Files off — verify it disappears. Try to disable the last enabled panel — verify the switch is disabled with a tooltip.

- [ ] **Step 9.6: Run all tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 9.7: Commit**

```bash
git add src/settings/sections/PanelSection.tsx \
        src/modules/settings/openSettingsWindow.ts \
        src/settings/SettingsApp.tsx
git commit -m "feat(settings): add Panel settings section for enabling/disabling sidebar panels"
```

---

## Final checks

- [ ] **Type-check clean:**
```bash
pnpm exec tsc --noEmit
```

- [ ] **All tests pass:**
```bash
pnpm test
```

- [ ] **Full smoke-test in dev** — verify all six panels switch correctly, the icon strip renders cleanly, the Tabs panel hides the horizontal tab bar, and Settings → Panel toggles take effect immediately.
