# Multi-Function Sidebar Panel — Design Spec

**Date:** 2026-05-22  
**Branch:** `feature_side-panel`  
**Status:** Approved, ready for implementation

---

## Overview

Transform the existing sidebar (currently a two-view pane: Files / Source Control) into a multi-function tool panel with six pluggable views. Each view is represented by an icon-only tab in a compact strip at the **top** of the sidebar. Views can be individually enabled or disabled from a new "Panel" settings page. Only enabled views appear in the strip.

---

## Panels

| ID | Label | Icon | Default enabled | Component source |
|---|---|---|---|---|
| `explorer` | Files | `FolderTreeIcon` | true | `@/modules/explorer` (existing) |
| `source-control` | Source Control | `FolderGitTwoIcon` | true | `@/modules/source-control` (existing) |
| `tabs` | Tabs | `Tab01Icon` (or equivalent) | true | new `panels/VerticalTabsPanel.tsx` |
| `search` | Search | `Search01Icon` | false | new `panels/WorkspaceSearchPanel.tsx` |
| `outline` | Outline | `ListViewIcon` | false | new `panels/OutlinePanel.tsx` |
| `recent` | Recent | `Clock01Icon` | false | new `panels/RecentFilesPanel.tsx` |

---

## Architecture

### New files

```
src/modules/sidebar/
  PanelTabStrip.tsx          # icon-only tab bar at the top of the sidebar
  SidebarPanelHost.tsx       # replaces the inline sidebar block in App.tsx
  panels/
    VerticalTabsPanel.tsx
    WorkspaceSearchPanel.tsx
    OutlinePanel.tsx
    RecentFilesPanel.tsx
  types.ts                   # SidebarViewId union (updated)
  index.ts                   # barrel (updated)

src/settings/sections/
  PanelSection.tsx           # new settings section

docs/superpowers/specs/
  2026-05-22-side-panel-design.md   # this file
```

### Modified files

| File | Change |
|---|---|
| `src/modules/sidebar/types.ts` | Expand `SidebarViewId` with `"tabs" \| "search" \| "outline" \| "recent"` |
| `src/modules/sidebar/index.ts` | Export `SidebarPanelHost`, remove `SidebarRail` export |
| `src/app/App.tsx` | Replace ~25-line sidebar block with `<SidebarPanelHost />`, read `sidebarPanelTabs` pref and pass `showTabBar={!sidebarPanelTabs}` to `<Header>` |
| `src/modules/settings/store.ts` | Add 6 pref keys + setters |
| `src/modules/settings/preferences.ts` | Add 6 fields + defaults to `Preferences` / `DEFAULT_PREFERENCES` |
| `src/settings/SettingsApp.tsx` | Add `"panel"` tab entry |
| `src/modules/settings/openSettingsWindow.ts` | Add `"panel"` to `SettingsTab` union |
| `src/modules/header/Header.tsx` | Accept `showTabBar: boolean` prop; conditionally render `<TabBar>` |

### Deleted files

- `src/modules/sidebar/SidebarRail.tsx` — replaced by `PanelTabStrip.tsx`

---

## Component Design

### `PanelTabStrip`

```tsx
type PanelDescriptor = {
  id: SidebarViewId;
  label: string;
  icon: HugeiconType;
  badge?: number;
};

type Props = {
  panels: PanelDescriptor[];   // only enabled panels, pre-filtered
  activeView: SidebarViewId;
  onSelectView: (id: SidebarViewId) => void;
};
```

- Renders a `div` with `display:flex; gap; padding` at the top of the sidebar.
- Each button: 28×28px, rounded, icon only, tooltip with `label` on hover.
- Active: `bg-foreground/[0.07]` + `strokeWidth={2}`. Inactive: `text-muted-foreground` + hover lift.
- Badge (for source-control changed count): small counter pill, same style as existing `SidebarRail` badge.
- Clicking the already-active panel collapses the sidebar (same behaviour as today's `cycleSidebarView`).
- Height: ~36px to match `SIDEBAR_RAIL_HEIGHT`.

### `SidebarPanelHost`

Owns all sidebar interior logic. Reads panel-enabled prefs, builds the `PanelDescriptor[]`, renders `PanelTabStrip` + the active panel's content.

```tsx
type Props = {
  // passed from App.tsx — same callbacks the panels need
  explorerRef: RefObject<FileExplorerHandle>;
  explorerRoot: string | null;
  activeTab: Tab | undefined;
  tabs: Tab[];
  sourceControl: SourceControlState;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed: (from: string, to: string) => void;
  onPathDeleted: (path: string) => void;
  onRevealInTerminal: (path: string) => void;
  onAttachToAgent: (path: string) => void;
  onOpenMarkdownPreview: (path: string) => void;
  onOpenDiff: (...) => void;
  onOpenGitGraph: () => void;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  sidebarRef: RefObject<PanelImperativeHandle>;
  activeView: SidebarViewId;
  onSelectView: (view: SidebarViewId) => void;
};
```

Internal behaviour:
- Reads `sidebarPanel*` prefs from `usePreferencesStore`.
- Filters the full panel registry to only enabled panels.
- If `activeView` is no longer in the enabled set, auto-advances to the first enabled panel.
- If `panels.length === 0` (all disabled — should not happen due to Settings guard), renders nothing and collapses the sidebar.
- Persists `activeView` changes via `onSelectView` (which writes to localStorage, same as today).

Panel content is rendered with the same `invisible pointer-events-none` / `absolute inset-0` pattern used for workspace tabs — no panel is unmounted on switch, preserving scroll position and search state.

---

## Preferences

Six new keys added to `terax-settings.json` via `tauri-plugin-store`:

| Pref key | Store key | Default |
|---|---|---|
| `sidebarPanelExplorer` | `"sidebarPanelExplorer"` | `true` |
| `sidebarPanelSourceControl` | `"sidebarPanelSourceControl"` | `true` |
| `sidebarPanelTabs` | `"sidebarPanelTabs"` | `true` |
| `sidebarPanelSearch` | `"sidebarPanelSearch"` | `false` |
| `sidebarPanelOutline` | `"sidebarPanelOutline"` | `false` |
| `sidebarPanelRecent` | `"sidebarPanelRecent"` | `false` |

Each gets a `setSidebarPanel*(value: boolean)` setter in `store.ts` and is wired through `onPreferencesChange` for cross-window sync.

---

## Settings — "Panel" Section

New tab added to the Settings window between "Shortcuts" and "Models":

```
Settings > Panel
```

Renders one `SettingRow` per panel:

| Row title | Description | Control |
|---|---|---|
| Files | File tree and project explorer | Switch |
| Source Control | Git status, stage, commit | Switch |
| Tabs | Vertical tab list (hides the top tab bar) | Switch |
| Search | Find in files across the workspace | Switch |
| Outline | Symbol tree for the active editor file | Switch |
| Recent Files | Quick access to recently opened files | Switch |

Guard: if toggling a panel off would leave zero enabled panels, the switch is disabled with a tooltip "At least one panel must remain enabled."

---

## Behaviour Details

### Vertical Tabs panel + tab bar

- When `sidebarPanelTabs` is `true`, App.tsx passes `showTabBar={false}` to `<Header>`, which conditionally renders `<TabBar>`. The `feature_side-panel` branch name suggests this is the primary motivating feature.
- The vertical list renders all tabs in order. Row contents: tab-kind icon (terminal, editor, preview, etc.), title, dirty dot for editors, `×` close button.
- Active tab is highlighted. Click → `onSelectTab`. Close → `onCloseTab` (which already handles dirty-editor confirmation).
- Scrollable; uses `@tanstack/react-virtual` for lists > ~30 tabs to avoid layout thrash.

### Workspace Search panel

- Controlled input, debounced 300ms, calls `fs_grep` Rust command with `explorerRoot` as the base path.
- Results grouped by relative file path. Each match: line number chip + line text snippet (truncated at 120 chars).
- Click a match: calls `onOpenFile(absolutePath)`. Does not jump to line (CodeMirror line-jump is a future enhancement).
- Empty state: "Type to search across files". No-results state: "No matches found."

### Outline panel

- Reads the active editor's CodeMirror state via the `EditorPaneHandle` (a new `getOutline(): OutlineNode[]` method added to the handle interface).
- `OutlineNode`: `{ label: string; kind: "function"|"class"|"variable"|"heading"; depth: number; line: number }`.
- Derived from Lezer tree walking — no LSP required. Supports: JS/TS (functions, classes, arrow functions assigned to `const`), Rust (fn, struct, impl, enum), Python (def, class), Go (func, type), Markdown (headings).
- Falls back to empty state with "No outline available" for unsupported languages.
- Clicking a node calls a new `goToLine(line: number)` method on `EditorPaneHandle`.
- Re-derives on editor content change via a `useEffect` on a debounced version of the document.

### Recent Files panel

- `recentFilesStore`: Zustand store, `paths: string[]` (max 50, deduplicated, newest first).
- `App.tsx` calls `recentFilesStore.getState().push(path)` inside `openFileTab`.
- Persisted to `localStorage` at key `terax.recent-files`.
- Each row: file icon (from `iconResolver`), filename, truncated parent path. Click → `onOpenFile`.
- "Clear" button at the bottom clears the list.

---

## What This Does NOT Include

- LSP integration for Outline (Lezer-only, no language server)
- Jumping to a specific line from Search results
- Drag-to-reorder tabs in the Vertical Tabs panel
- Pinning/unpinning files in Recent
- Any changes to the right-side AI panel
