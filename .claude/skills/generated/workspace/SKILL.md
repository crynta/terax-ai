---
name: workspace
description: "Skill for the Workspace area of terax-ai. 34 symbols across 5 files."
---

# Workspace

34 symbols | 5 files | Cohesion: 78%

## When to Use

- Working with code in `src/`
- Understanding how workspaceAuthorize, readFile, writeFile work
- Modifying workspace-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/ai/lib/native.ts` | workspaceAuthorize, readFile, writeFile, createFile, createDir (+24) |
| `src/modules/ai/lib/composer.tsx` | onAttach, attachFileByPath |
| `src/modules/editor/lib/useDocument.ts` | reload |
| `src/modules/workspace/env.ts` | currentWorkspaceEnv |
| `src/modules/explorer/ExplorerSearch.tsx` | handle |

## Entry Points

Start here when exploring this area:

- **`workspaceAuthorize`** (Function) — `src/modules/ai/lib/native.ts:127`
- **`readFile`** (Function) — `src/modules/ai/lib/native.ts:132`
- **`writeFile`** (Function) — `src/modules/ai/lib/native.ts:137`
- **`createFile`** (Function) — `src/modules/ai/lib/native.ts:148`
- **`createDir`** (Function) — `src/modules/ai/lib/native.ts:150`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `workspaceAuthorize` | Function | `src/modules/ai/lib/native.ts` | 127 |
| `readFile` | Function | `src/modules/ai/lib/native.ts` | 132 |
| `writeFile` | Function | `src/modules/ai/lib/native.ts` | 137 |
| `createFile` | Function | `src/modules/ai/lib/native.ts` | 148 |
| `createDir` | Function | `src/modules/ai/lib/native.ts` | 150 |
| `readDir` | Function | `src/modules/ai/lib/native.ts` | 154 |
| `grep` | Function | `src/modules/ai/lib/native.ts` | 160 |
| `glob` | Function | `src/modules/ai/lib/native.ts` | 175 |
| `runCommand` | Function | `src/modules/ai/lib/native.ts` | 182 |
| `shellSessionOpen` | Function | `src/modules/ai/lib/native.ts` | 194 |
| `shellSessionRun` | Function | `src/modules/ai/lib/native.ts` | 199 |
| `shellBgSpawn` | Function | `src/modules/ai/lib/native.ts` | 221 |
| `gitResolveRepo` | Function | `src/modules/ai/lib/native.ts` | 247 |
| `gitPanelSnapshot` | Function | `src/modules/ai/lib/native.ts` | 252 |
| `gitStatus` | Function | `src/modules/ai/lib/native.ts` | 257 |
| `gitDiff` | Function | `src/modules/ai/lib/native.ts` | 262 |
| `gitDiffContent` | Function | `src/modules/ai/lib/native.ts` | 269 |
| `gitStage` | Function | `src/modules/ai/lib/native.ts` | 282 |
| `gitUnstage` | Function | `src/modules/ai/lib/native.ts` | 288 |
| `gitDiscard` | Function | `src/modules/ai/lib/native.ts` | 294 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run → CurrentWorkspaceEnv` | cross_community | 7 |
| `GitDiffPane → CurrentWorkspaceEnv` | cross_community | 6 |
| `UseTerminalSession → CurrentWorkspaceEnv` | cross_community | 5 |
| `HandleLeafExit → CurrentWorkspaceEnv` | cross_community | 5 |
| `Git_diff_content → CurrentWorkspaceEnv` | cross_community | 5 |
| `AiInputBar → CurrentWorkspaceEnv` | cross_community | 4 |
| `FileExplorer → CurrentWorkspaceEnv` | cross_community | 4 |
| `Shell_session_open → CurrentWorkspaceEnv` | cross_community | 4 |
| `EditorStack → CurrentWorkspaceEnv` | cross_community | 4 |
| `Fs_watch_add → CurrentWorkspaceEnv` | cross_community | 4 |

## How to Explore

1. `gitnexus_context({name: "workspaceAuthorize"})` — see callers and callees
2. `gitnexus_query({query: "workspace"})` — find related execution flows
3. Read key files listed above for implementation details
