# Split Panes Plan

## Goal

Add iTerm/zellij/tmux-style split panes to TERAX-Custom while keeping the current tab model usable.

The desired UX is:

- Keep tabs as top-level workspaces.
- Allow each tab/workspace to contain one or more panes.
- Split the active pane horizontally or vertically.
- Panes can contain terminals first, then later editors/previews.
- Focus can move between panes with keyboard shortcuts and mouse clicks.
- Closing a pane should not destroy the whole workspace unless it is the last pane.

## Current Architecture

The app is currently tab-first:

- `src/modules/tabs/lib/useTabs.ts` stores one flat list of tabs.
- `activeId` points to exactly one active tab.
- `TerminalStack`, `EditorStack`, `PreviewStack`, and `AiDiffStack` render all tabs of their type but hide every inactive one.
- `App.tsx` routes actions like search, cwd, AI context, terminal handles, editor handles, and preview handles through `activeId`.
- `react-resizable-panels` is already used for the sidebar/workspace split, so the project already has a resizing primitive.

This means splits are possible, but the clean path is to introduce a pane layout layer rather than force multiple active tab IDs through the current stacks.

## Scope Options

### Option A: Terminal-Only Splits MVP

Smallest useful version.

- Only terminal panes can be split.
- Existing editor/preview/AI diff tabs keep working as normal tabs.
- Each terminal tab becomes a workspace that can hold a tree of terminal panes.
- New split creates a new PTY/session.
- Active pane controls statusbar cwd, AI terminal context, search, and paste/write actions.

Estimated complexity: medium.

Risk: lower, because editors/previews do not need to be refactored yet.

### Option B: Universal Panes

More like a full IDE/workspace layout.

- Any pane can contain terminal, editor, preview, or AI diff.
- Tabs become named layouts/workspaces.
- Opening a file can open in the active pane or a new pane.
- Preview can live side-by-side with terminal/editor.

Estimated complexity: high.

Risk: higher, because many assumptions in `App.tsx` and stack components depend on one active tab.

### Recommendation

Start with Option A.

It gives the core terminal workflow quickly and keeps the refactor bounded. Once terminal splits are stable, extend the same layout model to editors and previews.

## Proposed Data Model

Add a pane tree separate from the tab list.

```ts
type PaneId = number;

type PaneLeaf = {
  kind: "leaf";
  paneId: PaneId;
  tabId: number;
};

type PaneSplit = {
  kind: "split";
  direction: "horizontal" | "vertical";
  children: PaneNode[];
  sizes?: number[];
};

type PaneNode = PaneLeaf | PaneSplit;
```

For the terminal-only MVP:

- Keep `Tab` mostly as-is.
- A terminal tab may own a `PaneNode` layout.
- Each terminal pane still maps to a normal terminal tab/session ID internally, or to a new `TerminalPaneModel`.

Cleaner but larger refactor:

```ts
type WorkspaceTab = {
  id: number;
  kind: "workspace";
  title: string;
  layout: PaneNode;
  activePaneId: PaneId;
};
```

For the MVP, avoid that larger migration unless the simple approach becomes messy.

## MVP Behavior

### Commands

- Split right: create a vertical split beside the active terminal.
- Split down: create a horizontal split below the active terminal.
- Close pane: close only the active pane.
- Focus next pane.
- Focus previous pane.
- Move focus left/right/up/down later.

### Shortcuts

Candidate shortcuts:

- `Cmd+D`: split right, matching iTerm.
- `Cmd+Shift+D`: split down, matching iTerm.
- `Cmd+W`: close active pane if more than one pane, otherwise close tab.
- `Cmd+Option+Arrow`: move focus between panes.

Need to verify conflicts with current shortcuts before implementing.

### UI

- Add split actions to tab/header menu.
- Active pane gets a subtle border/ring.
- Pane close button can be hidden at first; shortcut and context menu are enough for MVP.
- Resizers use `react-resizable-panels`.

## Implementation Plan

### Phase 1: Internal Layout Model

- Add `src/modules/panes/` with pure helpers:
  - create initial layout
  - split active pane
  - remove pane
  - find active pane/tab
  - list leaf panes
- Add focused unit tests for these helpers.
- Keep the helpers UI-agnostic.

### Phase 2: Terminal Split Rendering

- Replace the single `TerminalStack` workspace rendering path with a recursive pane renderer for terminal tabs.
- Each leaf renders one `TerminalPane`.
- Keep existing `TerminalPane` lifecycle and handle registration.
- Ensure hidden panes do not receive pointer input.
- Fit/resizing must still call xterm fit/pty resize correctly.

### Phase 3: App Routing

- Make `activeId` mean active top-level tab/workspace.
- Add active pane ID for terminal workspaces.
- Route these through active pane:
  - terminal write/inject
  - terminal selection
  - search target
  - cwd/statusbar
  - detected local URL
  - detected SSH target
  - AI terminal context

### Phase 4: UX Controls

- Add commands and shortcuts:
  - split right
  - split down
  - close pane
  - focus next/previous pane
- Add menu items in the tab/header new menu.
- Add active pane visual state.

### Phase 5: Persistence

- Decide whether layouts persist across app restarts.
- MVP can skip persistence.
- If persisted, store pane layout in existing preference/store system.

### Phase 6: Universal Panes Later

After terminal splits are stable:

- Allow editor panes.
- Allow preview panes.
- Decide file-open behavior:
  - open as tab
  - open in active pane
  - open to the side
- Add drag/move pane behavior only if needed.

## Risks

- `activeId` is currently used everywhere; changing semantics too broadly could break editor/preview/AI workflows.
- xterm fit/resize may need careful handling when panes are resized.
- Closing panes must clean up PTYs and refs correctly.
- Search currently targets one active terminal/editor; pane focus needs to become the source of truth.
- AI context currently reads active terminal buffer by `activeId`; needs pane awareness.

## Test Plan

Automated:

- Unit tests for pane tree helpers.
- `./node_modules/.bin/tsc --noEmit`
- `./node_modules/.bin/tsc && ./node_modules/.bin/vite build`
- `cd src-tauri && cargo check`

Manual:

- Open app.
- Split terminal right.
- Split terminal down.
- Type in each pane and verify independent sessions.
- Resize panes and verify terminal redraw.
- Close one pane and verify other pane stays alive.
- SSH in one pane and verify remote file chip uses the focused pane.
- Select text in one pane and verify auto-copy still works.
- Open preview/editor tab and verify old tab behavior still works.

## Decision

Do not start with universal IDE panes.

Start with terminal-only splits as a contained MVP. If the model feels good, extend the pane tree to editor and preview content later.
