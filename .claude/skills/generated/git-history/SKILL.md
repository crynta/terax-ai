---
name: git-history
description: "Skill for the Git-history area of terax-ai. 34 symbols across 5 files."
---

# Git-history

34 symbols | 5 files | Cohesion: 70%

## When to Use

- Working with code in `src/`
- Understanding how bumpFiles, loadInitial, loadMore work
- Modifying git-history-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/git-history/GitHistoryPane.tsx` | normalizeError, bumpFiles, loadInitial, loadMore, handleScroll (+19) |
| `src/modules/git-history/GraphRail.tsx` | laneX, railWidth, renderTopEdge, renderBottomEdge, GraphRail |
| `src/modules/git-history/lib/remoteWebUrl.ts` | parseRemoteWebUrl, commitWebUrl, hostLabel |
| `src/components/ui/popover.tsx` | PopoverAnchor |
| `src/modules/git-history/GitHistoryStack.tsx` | GitHistoryStack |

## Entry Points

Start here when exploring this area:

- **`bumpFiles`** (Function) — `src/modules/git-history/GitHistoryPane.tsx:223`
- **`loadInitial`** (Function) — `src/modules/git-history/GitHistoryPane.tsx:316`
- **`loadMore`** (Function) — `src/modules/git-history/GitHistoryPane.tsx:334`
- **`handleScroll`** (Function) — `src/modules/git-history/GitHistoryPane.tsx:388`
- **`id`** (Function) — `src/modules/git-history/GitHistoryPane.tsx:411`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `bumpFiles` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 223 |
| `loadInitial` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 316 |
| `loadMore` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 334 |
| `handleScroll` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 388 |
| `id` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 411 |
| `handleRefresh` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 417 |
| `fetchFiles` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 424 |
| `handleRowClick` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 452 |
| `parseRemoteWebUrl` | Function | `src/modules/git-history/lib/remoteWebUrl.ts` | 19 |
| `GitHistoryPane` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 191 |
| `closePopover` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 476 |
| `GitHistoryStack` | Function | `src/modules/git-history/GitHistoryStack.tsx` | 19 |
| `railWidth` | Function | `src/modules/git-history/GraphRail.tsx` | 14 |
| `GraphRail` | Function | `src/modules/git-history/GraphRail.tsx` | 98 |
| `commitWebUrl` | Function | `src/modules/git-history/lib/remoteWebUrl.ts` | 61 |
| `hostLabel` | Function | `src/modules/git-history/lib/remoteWebUrl.ts` | 72 |
| `normalizeError` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 98 |
| `PopoverAnchor` | Function | `src/components/ui/popover.tsx` | 41 |
| `CenterPlaceholder` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 678 |
| `basename` | Function | `src/modules/git-history/GitHistoryPane.tsx` | 86 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Ui | 9 calls |
| Cluster_145 | 1 calls |
| Components | 1 calls |
| Explorer | 1 calls |

## How to Explore

1. `gitnexus_context({name: "bumpFiles"})` — see callers and callees
2. `gitnexus_query({query: "git-history"})` — find related execution flows
3. Read key files listed above for implementation details
