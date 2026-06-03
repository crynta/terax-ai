---
name: source-control
description: "Skill for the Source-control area of terax-ai. 58 symbols across 5 files."
---

# Source-control

58 symbols | 5 files | Cohesion: 87%

## When to Use

- Working with code in `src/`
- Understanding how invalidateDiff, useSourceControlPanel, cancelReconcile work
- Modifying source-control-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/source-control/useSourceControlPanel.ts` | optimisticStage, optimisticUnstage, optimisticDiscard, useSourceControlPanel, cancelReconcile (+29) |
| `src/modules/source-control/SourceControlPanel.tsx` | basename, dirname, entryPathLabel, statusAccent, checkboxValue (+8) |
| `src/modules/source-control/useSourceControl.ts` | normalizeError, getContextualAction, touchAutoFetch, doRefresh, refresh (+3) |
| `src/modules/editor/lib/diffCache.ts` | invalidateDiff, invalidateRepoDiffs |
| `src/components/ui/checkbox.tsx` | Checkbox |

## Entry Points

Start here when exploring this area:

- **`invalidateDiff`** (Function) — `src/modules/editor/lib/diffCache.ts:29`
- **`useSourceControlPanel`** (Function) — `src/modules/source-control/useSourceControlPanel.ts:355`
- **`cancelReconcile`** (Function) — `src/modules/source-control/useSourceControlPanel.ts:527`
- **`scheduleReconcile`** (Function) — `src/modules/source-control/useSourceControlPanel.ts:534`
- **`runMutation`** (Function) — `src/modules/source-control/useSourceControlPanel.ts:660`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `invalidateDiff` | Function | `src/modules/editor/lib/diffCache.ts` | 29 |
| `useSourceControlPanel` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 355 |
| `cancelReconcile` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 527 |
| `scheduleReconcile` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 534 |
| `runMutation` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 660 |
| `stageEntry` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 690 |
| `unstageEntry` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 704 |
| `confirmPendingDiscard` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 735 |
| `stageAllEntries` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 757 |
| `unstageAllEntries` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 768 |
| `toggleStageFile` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 800 |
| `toggleAll` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 823 |
| `doRefresh` | Function | `src/modules/source-control/useSourceControl.ts` | 204 |
| `refresh` | Function | `src/modules/source-control/useSourceControl.ts` | 343 |
| `run` | Function | `src/modules/source-control/useSourceControl.ts` | 355 |
| `runRemoteAction` | Function | `src/modules/source-control/useSourceControl.ts` | 367 |
| `onFocus` | Function | `src/modules/source-control/useSourceControl.ts` | 450 |
| `generateCommitMessage` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 849 |
| `stagedEntries` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 408 |
| `unstagedEntries` | Function | `src/modules/source-control/useSourceControlPanel.ts` | 416 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `SourceControlPanel → IsCompatModelId` | cross_community | 6 |
| `EntryRow → ToIconifySlug` | cross_community | 5 |
| `RunRemoteAction → TouchAutoFetch` | intra_community | 4 |
| `RunRemoteAction → NormalizeError` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Ui | 7 calls |
| Explorer | 5 calls |
| Editor | 2 calls |
| Components | 1 calls |
| Theme | 1 calls |
| Ai | 1 calls |
| Cluster_142 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "invalidateDiff"})` — see callers and callees
2. `gitnexus_query({query: "source-control"})` — find related execution flows
3. Read key files listed above for implementation details
