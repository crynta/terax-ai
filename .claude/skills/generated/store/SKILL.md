---
name: store
description: "Skill for the Store area of terax-ai. 53 symbols across 13 files."
---

# Store

53 symbols | 13 files | Cohesion: 89%

## When to Use

- Working with code in `src/`
- Understanding how loadAll, saveSessionsList, saveActiveId work
- Modifying store-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/ai/store/chatStore.ts` | hydrateSessions, newSession, flip, deleteSession, renameSession (+14) |
| `src/modules/ai/lib/sessions.ts` | loadAll, saveSessionsList, saveActiveId, newSessionId, deriveTitle (+4) |
| `src/modules/ai/lib/todos.ts` | todosKey, loadTodos, saveTodos, deleteTodos |
| `src/modules/ai/store/agentsStore.ts` | setActiveId, upsert, remove, hydrate |
| `src/modules/ai/store/todoStore.ts` | hydrate, setTodos, clearSession |
| `src/modules/ai/lib/agents.ts` | saveCustomAgents, saveActiveAgentId, loadAgents |
| `src/modules/ai/store/snippetsStore.ts` | upsert, remove, hydrate |
| `src/modules/ai/lib/snippets.ts` | saveSnippets, loadSnippets |
| `src/modules/agents/store/managedAgentsStore.ts` | get, getBySessionId |
| `src/modules/ai/lib/transport.ts` | createContextAwareTransport |

## Entry Points

Start here when exploring this area:

- **`loadAll`** (Function) — `src/modules/ai/lib/sessions.ts:22`
- **`saveSessionsList`** (Function) — `src/modules/ai/lib/sessions.ts:40`
- **`saveActiveId`** (Function) — `src/modules/ai/lib/sessions.ts:44`
- **`newSessionId`** (Function) — `src/modules/ai/lib/sessions.ts:59`
- **`deriveTitle`** (Function) — `src/modules/ai/lib/sessions.ts:63`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `loadAll` | Function | `src/modules/ai/lib/sessions.ts` | 22 |
| `saveSessionsList` | Function | `src/modules/ai/lib/sessions.ts` | 40 |
| `saveActiveId` | Function | `src/modules/ai/lib/sessions.ts` | 44 |
| `newSessionId` | Function | `src/modules/ai/lib/sessions.ts` | 59 |
| `deriveTitle` | Function | `src/modules/ai/lib/sessions.ts` | 63 |
| `hydrateSessions` | Function | `src/modules/ai/store/chatStore.ts` | 399 |
| `newSession` | Function | `src/modules/ai/store/chatStore.ts` | 432 |
| `flip` | Function | `src/modules/ai/store/chatStore.ts` | 453 |
| `deleteSession` | Function | `src/modules/ai/store/chatStore.ts` | 467 |
| `renameSession` | Function | `src/modules/ai/store/chatStore.ts` | 500 |
| `persistMessages` | Function | `src/modules/ai/store/chatStore.ts` | 508 |
| `stop` | Function | `src/modules/ai/store/chatStore.ts` | 587 |
| `loadTodos` | Function | `src/modules/ai/lib/todos.ts` | 16 |
| `saveTodos` | Function | `src/modules/ai/lib/todos.ts` | 20 |
| `deleteTodos` | Function | `src/modules/ai/lib/todos.ts` | 27 |
| `createContextAwareTransport` | Function | `src/modules/ai/lib/transport.ts` | 73 |
| `getOrCreateChat` | Function | `src/modules/ai/store/chatStore.ts` | 560 |
| `stop` | Function | `src/modules/ai/lib/composer.tsx` | 321 |
| `saveCustomAgents` | Function | `src/modules/ai/lib/agents.ts` | 104 |
| `saveActiveAgentId` | Function | `src/modules/ai/lib/agents.ts` | 109 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Bridge → MessagesKey` | cross_community | 5 |

## How to Explore

1. `gitnexus_context({name: "loadAll"})` — see callers and callees
2. `gitnexus_query({query: "store"})` — find related execution flows
3. Read key files listed above for implementation details
