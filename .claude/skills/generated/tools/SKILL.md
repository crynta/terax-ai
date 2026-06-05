---
name: tools
description: "Skill for the Tools area of terax-ai. 41 symbols across 17 files."
---

# Tools

41 symbols | 17 files | Cohesion: 85%

## When to Use

- Working with code in `src/`
- Understanding how checkReadableCanonical, checkWritableCanonical, newQueuedEditId work
- Modifying tools-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/ai/tools/edit.ts` | djb2, applyEdits, execute, buildEditTools |
| `src/modules/ai/tools/search.ts` | resolveRoot, clipLine, execute, buildSearchTools |
| `src/modules/ai/tools/agent.ts` | hasControlChars, tailLines, execute, buildManagedAgentTools |
| `src/modules/ai/tools/shell.ts` | buildShellTools, getSessionShell, workspaceSessionKey, execute |
| `src/modules/ai/lib/security.ts` | checkReadableCanonical, checkWritableCanonical, checkShellCommand |
| `src/modules/ai/tools/fs.ts` | djb2, execute, buildFsTools |
| `src/app/App.tsx` | waitForClaudeTuiReady, spawnManagedAgent, readBuf |
| `src/modules/ai/tools/todo.ts` | buildTodoTools, normalized, execute |
| `src/modules/terminal/lib/useTerminalSession.ts` | whenSessionReady, writeToSession |
| `src/modules/ai/tools/subagent.ts` | buildSubagentTools, execute |

## Entry Points

Start here when exploring this area:

- **`checkReadableCanonical`** (Function) — `src/modules/ai/lib/security.ts:264`
- **`checkWritableCanonical`** (Function) — `src/modules/ai/lib/security.ts:290`
- **`newQueuedEditId`** (Function) — `src/modules/ai/store/planStore.ts:32`
- **`resolvePath`** (Function) — `src/modules/ai/tools/context.ts:24`
- **`execute`** (Function) — `src/modules/ai/tools/edit.ts:133`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `checkReadableCanonical` | Function | `src/modules/ai/lib/security.ts` | 264 |
| `checkWritableCanonical` | Function | `src/modules/ai/lib/security.ts` | 290 |
| `newQueuedEditId` | Function | `src/modules/ai/store/planStore.ts` | 32 |
| `resolvePath` | Function | `src/modules/ai/tools/context.ts` | 24 |
| `execute` | Function | `src/modules/ai/tools/edit.ts` | 133 |
| `execute` | Function | `src/modules/ai/tools/fs.ts` | 42 |
| `execute` | Function | `src/modules/ai/tools/search.ts` | 60 |
| `execute` | Function | `src/modules/ai/tools/agent.ts` | 38 |
| `whenSessionReady` | Function | `src/modules/terminal/lib/useTerminalSession.ts` | 79 |
| `writeToSession` | Function | `src/modules/terminal/lib/useTerminalSession.ts` | 94 |
| `spawnManagedAgent` | Function | `src/app/App.tsx` | 1381 |
| `readBuf` | Function | `src/app/App.tsx` | 1398 |
| `buildManagedAgentTools` | Function | `src/modules/ai/tools/agent.ts` | 24 |
| `buildEditTools` | Function | `src/modules/ai/tools/edit.ts` | 119 |
| `buildShellTools` | Function | `src/modules/ai/tools/shell.ts` | 29 |
| `buildSubagentTools` | Function | `src/modules/ai/tools/subagent.ts` | 9 |
| `buildTerminalTools` | Function | `src/modules/ai/tools/terminal.ts` | 5 |
| `buildTodoTools` | Function | `src/modules/ai/tools/todo.ts` | 8 |
| `buildTools` | Function | `src/modules/ai/tools/tools.ts` | 30 |
| `checkShellCommand` | Function | `src/modules/ai/lib/security.ts` | 323 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `GitDiffPane → WorkspaceScopeKey` | cross_community | 6 |
| `Execute → Basename` | cross_community | 5 |
| `Execute → ComparisonForm` | cross_community | 5 |
| `Execute → IsUnderProtected` | cross_community | 5 |
| `Execute → DescribeProtected` | cross_community | 5 |
| `Execute → Basename` | cross_community | 5 |
| `Execute → ComparisonForm` | cross_community | 5 |
| `Execute → IsUnderProtected` | cross_community | 5 |
| `Execute → DescribeProtected` | cross_community | 5 |
| `SpawnManagedAgent → IsLeaf` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Components | 2 calls |
| App | 1 calls |
| Workspace | 1 calls |
| Autocomplete | 1 calls |
| Ai | 1 calls |

## How to Explore

1. `gitnexus_context({name: "checkReadableCanonical"})` — see callers and callees
2. `gitnexus_query({query: "tools"})` — find related execution flows
3. Read key files listed above for implementation details
