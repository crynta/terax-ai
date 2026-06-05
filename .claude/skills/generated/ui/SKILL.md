---
name: ui
description: "Skill for the Ui area of terax-ai. 203 symbols across 66 files."
---

# Ui

203 symbols | 66 files | Cohesion: 57%

## When to Use

- Working with code in `src/`
- Understanding how cn, useTodosStore, ContextContent work
- Modifying ui-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/components/ui/menubar.tsx` | Menubar, MenubarPortal, MenubarTrigger, MenubarContent, MenubarItem (+7) |
| `src/components/ui/alert-dialog.tsx` | AlertDialogMedia, AlertDialog, AlertDialogPortal, AlertDialogOverlay, AlertDialogContent (+6) |
| `src/components/ui/item.tsx` | ItemGroup, ItemSeparator, Item, ItemMedia, ItemContent (+5) |
| `src/components/ui/context-menu.tsx` | ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuCheckboxItem, ContextMenuRadioItem, ContextMenuLabel (+4) |
| `src/components/ui/dialog.tsx` | Dialog, DialogPortal, DialogOverlay, DialogContent, DialogHeader (+3) |
| `src/components/ui/card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardAction (+2) |
| `src/components/ui/sheet.tsx` | SheetPortal, SheetOverlay, SheetContent, SheetHeader, SheetFooter (+2) |
| `src/components/ai-elements/message.tsx` | MessageActions, MessageBranch, MessageBranchSelector, MessageBranchPage, MessageToolbar (+1) |
| `src/components/ui/empty.tsx` | Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription (+1) |
| `src/components/ui/input-group.tsx` | InputGroup, InputGroupAddon, InputGroupText, InputGroupInput, InputGroupButton (+1) |

## Entry Points

Start here when exploring this area:

- **`cn`** (Function) — `src/lib/utils.ts:3`
- **`useTodosStore`** (Function) — `src/modules/ai/store/todoStore.ts:18`
- **`ContextContent`** (Function) — `src/components/ai-elements/context.tsx:130`
- **`ContextContentHeader`** (Function) — `src/components/ai-elements/context.tsx:142`
- **`MessageActions`** (Function) — `src/components/ai-elements/message.tsx:67`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `cn` | Function | `src/lib/utils.ts` | 3 |
| `useTodosStore` | Function | `src/modules/ai/store/todoStore.ts` | 18 |
| `ContextContent` | Function | `src/components/ai-elements/context.tsx` | 130 |
| `ContextContentHeader` | Function | `src/components/ai-elements/context.tsx` | 142 |
| `MessageActions` | Function | `src/components/ai-elements/message.tsx` | 67 |
| `MessageBranch` | Function | `src/components/ai-elements/message.tsx` | 143 |
| `MessageBranchSelector` | Function | `src/components/ai-elements/message.tsx` | 229 |
| `MessageBranchPage` | Function | `src/components/ai-elements/message.tsx` | 300 |
| `MessageToolbar` | Function | `src/components/ai-elements/message.tsx` | 348 |
| `Snippet` | Function | `src/components/ai-elements/snippet.tsx` | 35 |
| `SnippetAddon` | Function | `src/components/ai-elements/snippet.tsx` | 54 |
| `SnippetText` | Function | `src/components/ai-elements/snippet.tsx` | 60 |
| `SnippetInput` | Function | `src/components/ai-elements/snippet.tsx` | 72 |
| `AgentStatusPill` | Function | `src/modules/ai/components/AgentStatusPill.tsx` | 11 |
| `AiMiniWindow` | Function | `src/modules/ai/components/AiMiniWindow.tsx` | 65 |
| `FilePickerContent` | Function | `src/modules/ai/components/FilePicker.tsx` | 16 |
| `SnippetPickerContent` | Function | `src/modules/ai/components/SnippetPicker.tsx` | 17 |
| `TodoStrip` | Function | `src/modules/ai/components/TodoStrip.tsx` | 20 |
| `hydrate` | Function | `src/modules/ai/components/TodoStrip.tsx` | 21 |
| `MarkdownPreviewPane` | Function | `src/modules/markdown/MarkdownPreviewPane.tsx` | 26 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `SourceControlPanel → IsCompatModelId` | cross_community | 6 |
| `UpdaterDialog → ParseVersion` | cross_community | 6 |
| `AiMiniWindow → Clamp` | cross_community | 5 |
| `EntryRowImpl → ToIconifySlug` | cross_community | 5 |
| `SourceControlPanel → Cn` | cross_community | 4 |
| `CommandPalette → Cn` | cross_community | 4 |
| `AiStatusBarControls → Cn` | cross_community | 4 |
| `ExplorerSearch → Cn` | cross_community | 4 |
| `AiTools → Cn` | cross_community | 4 |
| `UpdaterDialog → Cn` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Components | 15 calls |
| Explorer | 8 calls |
| Sections | 5 calls |
| Ai-elements | 5 calls |
| Updater | 2 calls |
| Source-control | 2 calls |
| Theme | 2 calls |
| Workspace | 2 calls |

## How to Explore

1. `gitnexus_context({name: "cn"})` — see callers and callees
2. `gitnexus_query({query: "ui"})` — find related execution flows
3. Read key files listed above for implementation details
