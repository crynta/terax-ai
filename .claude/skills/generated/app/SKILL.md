---
name: app
description: "Skill for the App area of terax-ai. 136 symbols across 29 files."
---

# App

136 symbols | 29 files | Cohesion: 76%

## When to Use

- Working with code in `src/`
- Understanding how getLaunchDir, parentDir, useSourceControl work
- Modifying app-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/app/App.tsx` | dirname, clampSidebarWidth, readSidebarWidth, App, persistSidebarWidth (+62) |
| `src/modules/tabs/lib/useTabs.ts` | useTabs, closeTab, splitActivePane, closePaneByLeaf, closeActivePane (+5) |
| `src/modules/terminal/lib/panes.ts` | isLeaf, leafIds, splitLeaf, removeLeaf, siblingLeafOf (+5) |
| `src/modules/terminal/lib/useTerminalSession.ts` | disposeSession, clearFocusedTerminal, deliverPtyBytes, onData, onExit (+5) |
| `src/modules/ai/components/lazy.tsx` | AgentRunBridgeInner, AiMiniWindowInner, SelectionAskAiInner, AgentRunBridge, AiMiniWindow (+1) |
| `src/modules/tabs/lib/useWindowTitle.ts` | basename, tabLabel, useWindowTitle |
| `src/modules/theme/themeFiles.ts` | starterTheme, onThemeEdit |
| `src/modules/workspace/env.ts` | useWorkspaceEnvStore, getWslHome |
| `src/modules/editor/AiDiffStackLazy.tsx` | AiDiffStackInner, AiDiffStack |
| `src/modules/editor/EditorStackLazy.tsx` | EditorStackInner, EditorStack |

## Entry Points

Start here when exploring this area:

- **`getLaunchDir`** (Function) — `src/lib/launchDir.ts:11`
- **`parentDir`** (Function) — `src/modules/explorer/lib/watch.ts:33`
- **`useSourceControl`** (Function) — `src/modules/source-control/useSourceControl.ts:145`
- **`useTabs`** (Function) — `src/modules/tabs/lib/useTabs.ts:138`
- **`useWorkspaceCwd`** (Function) — `src/modules/tabs/lib/useWorkspaceCwd.ts:8`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `DormantRing` | Class | `src/modules/terminal/lib/dormantRing.ts` | 7 |
| `getLaunchDir` | Function | `src/lib/launchDir.ts` | 11 |
| `parentDir` | Function | `src/modules/explorer/lib/watch.ts` | 33 |
| `useSourceControl` | Function | `src/modules/source-control/useSourceControl.ts` | 145 |
| `useTabs` | Function | `src/modules/tabs/lib/useTabs.ts` | 138 |
| `useWorkspaceCwd` | Function | `src/modules/tabs/lib/useWorkspaceCwd.ts` | 8 |
| `starterTheme` | Function | `src/modules/theme/themeFiles.ts` | 67 |
| `onThemeEdit` | Function | `src/modules/theme/themeFiles.ts` | 114 |
| `useWorkspaceEnvStore` | Function | `src/modules/workspace/env.ts` | 25 |
| `App` | Function | `src/app/App.tsx` | 185 |
| `persistSidebarWidth` | Function | `src/app/App.tsx` | 276 |
| `setSelectedModelId` | Function | `src/app/App.tsx` | 422 |
| `setLive` | Function | `src/app/App.tsx` | 423 |
| `respondToApproval` | Function | `src/app/App.tsx` | 424 |
| `initPrefs` | Function | `src/app/App.tsx` | 479 |
| `hydrateSessions` | Function | `src/app/App.tsx` | 489 |
| `cancelClose` | Function | `src/app/App.tsx` | 722 |
| `cancelDeleteClose` | Function | `src/app/App.tsx` | 921 |
| `AgentRunBridge` | Function | `src/modules/ai/components/lazy.tsx` | 26 |
| `AiMiniWindow` | Function | `src/modules/ai/components/lazy.tsx` | 34 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `SwitchWorkspace → IsAltScreen` | cross_community | 6 |
| `SwitchWorkspace → CancelPendingUnhide` | cross_community | 6 |
| `SwitchWorkspace → GetRecycler` | cross_community | 6 |
| `ClosePaneByLeaf → IsAltScreen` | cross_community | 6 |
| `ClosePaneByLeaf → CancelPendingUnhide` | cross_community | 6 |
| `ClosePaneByLeaf → GetRecycler` | cross_community | 6 |
| `CloseActivePane → IsAltScreen` | cross_community | 6 |
| `CloseActivePane → CancelPendingUnhide` | cross_community | 6 |
| `CloseActivePane → GetRecycler` | cross_community | 6 |
| `ModelsSection → ProviderNeedsKey` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Ui | 21 calls |
| Theme | 8 calls |
| Components | 6 calls |
| Editor | 2 calls |
| Explorer | 2 calls |
| Cluster_180 | 1 calls |
| Cluster_68 | 1 calls |
| Ai | 1 calls |

## How to Explore

1. `gitnexus_context({name: "getLaunchDir"})` — see callers and callees
2. `gitnexus_query({query: "app"})` — find related execution flows
3. Read key files listed above for implementation details
