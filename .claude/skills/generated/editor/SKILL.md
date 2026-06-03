---
name: editor
description: "Skill for the Editor area of terax-ai. 38 symbols across 11 files."
---

# Editor

38 symbols | 11 files | Cohesion: 81%

## When to Use

- Working with code in `src/`
- Understanding how getCachedDiff, workingDiffKey, commitDiffKey work
- Modifying editor-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/editor/EditorPane.tsx` | resolve, formatBytes, EditorPane, refresh, unsubPrefs (+2) |
| `src/modules/editor/lib/diffCache.ts` | touch, getCachedDiff, workingDiffKey, commitDiffKey, fetchWorkingDiff (+1) |
| `src/modules/editor/GitDiffPane.tsx` | cacheKey, loadStateFromCache, GitDiffPane, initialLang, countDiffLines (+1) |
| `src/modules/editor/lib/languageResolver.ts` | extOf, isStreamParser, cacheKey, resolveLanguageSync, resolveLanguage (+1) |
| `src/modules/editor/AiDiffPane.tsx` | initialLang, stats, computeLineStats, countLines |
| `src/modules/editor/EditorStack.tsx` | EditorStack, getRefCallback, getDirtyCallback, getCloseCallback |
| `src/modules/workspace/env.ts` | currentWorkspaceScopeKey |
| `src/modules/editor/GitDiffStack.tsx` | GitDiffStack |
| `src/modules/ai/lib/keyring.ts` | getKey |
| `src/modules/editor/lib/useDocument.ts` | useDocument |

## Entry Points

Start here when exploring this area:

- **`getCachedDiff`** (Function) — `src/modules/editor/lib/diffCache.ts:20`
- **`workingDiffKey`** (Function) — `src/modules/editor/lib/diffCache.ts:40`
- **`commitDiffKey`** (Function) — `src/modules/editor/lib/diffCache.ts:48`
- **`fetchWorkingDiff`** (Function) — `src/modules/editor/lib/diffCache.ts:56`
- **`fetchCommitDiff`** (Function) — `src/modules/editor/lib/diffCache.ts:80`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `getCachedDiff` | Function | `src/modules/editor/lib/diffCache.ts` | 20 |
| `workingDiffKey` | Function | `src/modules/editor/lib/diffCache.ts` | 40 |
| `commitDiffKey` | Function | `src/modules/editor/lib/diffCache.ts` | 48 |
| `fetchWorkingDiff` | Function | `src/modules/editor/lib/diffCache.ts` | 56 |
| `fetchCommitDiff` | Function | `src/modules/editor/lib/diffCache.ts` | 80 |
| `currentWorkspaceScopeKey` | Function | `src/modules/workspace/env.ts` | 55 |
| `GitDiffPane` | Function | `src/modules/editor/GitDiffPane.tsx` | 127 |
| `GitDiffStack` | Function | `src/modules/editor/GitDiffStack.tsx` | 12 |
| `resolveLanguageSync` | Function | `src/modules/editor/lib/languageResolver.ts` | 157 |
| `resolveLanguage` | Function | `src/modules/editor/lib/languageResolver.ts` | 162 |
| `preloadLanguages` | Function | `src/modules/editor/lib/languageResolver.ts` | 192 |
| `initialLang` | Function | `src/modules/editor/AiDiffPane.tsx` | 97 |
| `resolve` | Function | `src/modules/editor/EditorPane.tsx` | 194 |
| `initialLang` | Function | `src/modules/editor/GitDiffPane.tsx` | 200 |
| `getKey` | Function | `src/modules/ai/lib/keyring.ts` | 29 |
| `useDocument` | Function | `src/modules/editor/lib/useDocument.ts` | 22 |
| `onKeysChanged` | Function | `src/modules/settings/store.ts` | 620 |
| `EditorPane` | Function | `src/modules/editor/EditorPane.tsx` | 62 |
| `refresh` | Function | `src/modules/editor/EditorPane.tsx` | 75 |
| `unsubPrefs` | Function | `src/modules/editor/EditorPane.tsx` | 89 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `EditorStack → ProviderNeedsKey` | cross_community | 6 |
| `EditorStack → GetProvider` | cross_community | 6 |
| `GitDiffPane → WorkspaceScopeKey` | cross_community | 6 |
| `GitDiffPane → CurrentWorkspaceEnv` | cross_community | 6 |
| `ModelsSection → ProviderNeedsKey` | cross_community | 5 |
| `ModelsSection → GetProvider` | cross_community | 5 |
| `Reload → ProviderNeedsKey` | cross_community | 5 |
| `Reload → GetProvider` | cross_community | 5 |
| `EditorStack → UsePreferencesStore` | cross_community | 4 |
| `EditorStack → CurrentWorkspaceEnv` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Theme | 3 calls |
| Ui | 3 calls |
| Workspace | 2 calls |
| Ai | 2 calls |
| Tools | 1 calls |
| Sections | 1 calls |

## How to Explore

1. `gitnexus_context({name: "getCachedDiff"})` — see callers and callees
2. `gitnexus_query({query: "editor"})` — find related execution flows
3. Read key files listed above for implementation details
