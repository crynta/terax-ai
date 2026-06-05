---
name: components
description: "Skill for the Components area of terax-ai. 161 symbols across 44 files."
---

# Components

161 symbols | 44 files | Cohesion: 69%

## When to Use

- Working with code in `src/`
- Understanding how setDefaultModel, setAutocompleteEnabled, WindowControls work
- Modifying components-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/ai/components/AiChat.tsx` | CommandSnippet, countLines, stripUserContextBlocks, ContextChips, chipIcon (+12) |
| `src/modules/ai/components/AiMiniWindow.tsx` | SessionPicker, switchSession, newSession, deleteSession, SessionRow (+8) |
| `src/modules/ai/components/AiInputBar.tsx` | AiInputBar, onPickItem, onPickFile, pickActive, ChipsRow (+6) |
| `src/modules/ai/components/AiStatusBarControls.tsx` | AiOpenButton, AiStatusBarControls, IconBtn, ModelDropdown, setSelected (+5) |
| `src/modules/agents/components/NotificationBell.tsx` | relativeTime, NotificationRow, NotificationBell, activate, activateLocal (+5) |
| `src/modules/ai/components/AgentRunBridge.tsx` | AgentRunBridge, Bridge, patch, openMini, persistMessages (+4) |
| `src/modules/ai/components/PlanDiffReview.tsx` | PlanDiffReview, removeOne, clear, basename, diffStats (+4) |
| `src/components/ui/dropdown-menu.tsx` | DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel (+1) |
| `src/modules/ai/lib/security.ts` | basename, comparisonForm, isUnderProtected, describeProtected, checkReadable (+1) |
| `src/modules/preview/PreviewAddressBar.tsx` | PreviewAddressBar, submit, tryPort, probeUrl, normalizeUrl |

## Entry Points

Start here when exploring this area:

- **`setDefaultModel`** (Function) — `src/modules/settings/store.ts:374`
- **`setAutocompleteEnabled`** (Function) — `src/modules/settings/store.ts:394`
- **`WindowControls`** (Function) — `src/components/WindowControls.tsx:17`
- **`AgentSwitcher`** (Function) — `src/modules/ai/components/AgentSwitcher.tsx:34`
- **`setActiveId`** (Function) — `src/modules/ai/components/AgentSwitcher.tsx:38`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `setDefaultModel` | Function | `src/modules/settings/store.ts` | 374 |
| `setAutocompleteEnabled` | Function | `src/modules/settings/store.ts` | 394 |
| `WindowControls` | Function | `src/components/WindowControls.tsx` | 17 |
| `AgentSwitcher` | Function | `src/modules/ai/components/AgentSwitcher.tsx` | 34 |
| `setActiveId` | Function | `src/modules/ai/components/AgentSwitcher.tsx` | 38 |
| `Header` | Function | `src/modules/header/Header.tsx` | 60 |
| `PreviewAddressBar` | Function | `src/modules/preview/PreviewAddressBar.tsx` | 59 |
| `submit` | Function | `src/modules/preview/PreviewAddressBar.tsx` | 86 |
| `tryPort` | Function | `src/modules/preview/PreviewAddressBar.tsx` | 97 |
| `AiTools` | Function | `src/modules/statusbar/AiTools.tsx` | 32 |
| `WorkspaceEnvSelector` | Function | `src/modules/statusbar/WorkspaceEnvSelector.tsx` | 20 |
| `refreshDistros` | Function | `src/modules/statusbar/WorkspaceEnvSelector.tsx` | 27 |
| `handleOpenChange` | Function | `src/modules/statusbar/WorkspaceEnvSelector.tsx` | 29 |
| `ProviderIcon` | Function | `src/settings/components/ProviderIcon.tsx` | 40 |
| `ProviderKeyCard` | Function | `src/settings/components/ProviderKeyCard.tsx` | 32 |
| `submit` | Function | `src/settings/components/ProviderKeyCard.tsx` | 49 |
| `Message` | Function | `src/components/ai-elements/message.tsx` | 32 |
| `MessageContent` | Function | `src/components/ai-elements/message.tsx` | 47 |
| `useWorkspaceFiles` | Function | `src/modules/ai/hooks/useWorkspaceFiles.ts` | 49 |
| `AiInputBar` | Function | `src/modules/ai/components/AiInputBar.tsx` | 70 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `EditorStack → ProviderNeedsKey` | cross_community | 6 |
| `LocalAgentNotificationsBridge → IconFor` | cross_community | 6 |
| `ModelsSection → ProviderNeedsKey` | cross_community | 5 |
| `Run → ProviderNeedsKey` | cross_community | 5 |
| `Execute → Basename` | cross_community | 5 |
| `Execute → ComparisonForm` | cross_community | 5 |
| `Execute → IsUnderProtected` | cross_community | 5 |
| `Execute → DescribeProtected` | cross_community | 5 |
| `Reload → ProviderNeedsKey` | cross_community | 5 |
| `Bridge → MessagesKey` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Ui | 58 calls |
| Ai | 6 calls |
| App | 5 calls |
| Theme | 4 calls |
| Settings | 4 calls |
| Sections | 4 calls |
| Header | 3 calls |
| Ai-elements | 2 calls |

## How to Explore

1. `gitnexus_context({name: "setDefaultModel"})` — see callers and callees
2. `gitnexus_query({query: "components"})` — find related execution flows
3. Read key files listed above for implementation details
