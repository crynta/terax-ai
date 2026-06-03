---
name: autocomplete
description: "Skill for the Autocomplete area of terax-ai. 34 symbols across 9 files."
---

# Autocomplete

34 symbols | 9 files | Cohesion: 84%

## When to Use

- Working with code in `src/`
- Understanding how detectMonoFontFamily, inlineCompletion, buildSharedExtensions work
- Modifying autocomplete-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/editor/lib/autocomplete/inlineExtension.ts` | suggestionKey, hasProviderKey, shouldTrigger, clearGhost, fire (+19) |
| `src/modules/editor/lib/autocomplete/prompt.ts` | trimContext, buildUserPrompt |
| `src/modules/editor/lib/autocomplete/provider.ts` | requestCompletion, cleanCompletion |
| `src/lib/fonts.ts` | detectMonoFontFamily |
| `src/modules/editor/lib/extensions.ts` | buildSharedExtensions |
| `src/modules/editor/lib/vim.ts` | vimHandlersExtension |
| `src/modules/terminal/lib/rendererPool.ts` | applyFontFamily |
| `src/modules/editor/EditorPane.tsx` | extensions |
| `src/modules/ai/lib/agent.ts` | buildLanguageModel |

## Entry Points

Start here when exploring this area:

- **`detectMonoFontFamily`** (Function) — `src/lib/fonts.ts:36`
- **`inlineCompletion`** (Function) — `src/modules/editor/lib/autocomplete/inlineExtension.ts:463`
- **`buildSharedExtensions`** (Function) — `src/modules/editor/lib/extensions.ts:17`
- **`vimHandlersExtension`** (Function) — `src/modules/editor/lib/vim.ts:9`
- **`applyFontFamily`** (Function) — `src/modules/terminal/lib/rendererPool.ts:661`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `detectMonoFontFamily` | Function | `src/lib/fonts.ts` | 36 |
| `inlineCompletion` | Function | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 463 |
| `buildSharedExtensions` | Function | `src/modules/editor/lib/extensions.ts` | 17 |
| `vimHandlersExtension` | Function | `src/modules/editor/lib/vim.ts` | 9 |
| `applyFontFamily` | Function | `src/modules/terminal/lib/rendererPool.ts` | 661 |
| `extensions` | Function | `src/modules/editor/EditorPane.tsx` | 115 |
| `buildLanguageModel` | Function | `src/modules/ai/lib/agent.ts` | 75 |
| `trimContext` | Function | `src/modules/editor/lib/autocomplete/prompt.ts` | 10 |
| `buildUserPrompt` | Function | `src/modules/editor/lib/autocomplete/prompt.ts` | 57 |
| `requestCompletion` | Function | `src/modules/editor/lib/autocomplete/provider.ts` | 30 |
| `plugin` | Function | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 464 |
| `manualTrigger` | Function | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 466 |
| `LRU` | Class | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 132 |
| `CompletionDriver` | Class | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 195 |
| `GhostWidget` | Class | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 78 |
| `suggestionKey` | Function | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 155 |
| `hasProviderKey` | Function | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 161 |
| `shouldTrigger` | Function | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 166 |
| `trimSuggestion` | Function | `src/modules/editor/lib/autocomplete/inlineExtension.ts` | 359 |
| `cleanCompletion` | Function | `src/modules/editor/lib/autocomplete/provider.ts` | 75 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run → ProviderNeedsKey` | cross_community | 5 |
| `Run → LRU` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Components | 1 calls |

## How to Explore

1. `gitnexus_context({name: "detectMonoFontFamily"})` — see callers and callees
2. `gitnexus_query({query: "autocomplete"})` — find related execution flows
3. Read key files listed above for implementation details
