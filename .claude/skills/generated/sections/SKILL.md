---
name: sections
description: "Skill for the Sections area of terax-ai. 57 symbols across 14 files."
---

# Sections

57 symbols | 14 files | Cohesion: 61%

## When to Use

- Working with code in `src/`
- Understanding how getCustomEndpointKey, setCustomEndpointKey, clearCustomEndpointKey work
- Modifying sections-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/settings/sections/ModelsSection.tsx` | ModelsSection, onClearKey, onSaveEndpointKey, onClearEndpointKey, localConfig (+15) |
| `src/settings/sections/AgentsSection.tsx` | AgentsSection, setActiveAgentId, upsertAgent, removeAgent, hydrateAgents (+4) |
| `src/modules/ai/lib/keyring.ts` | compatKeyringAccount, getCustomEndpointKey, setCustomEndpointKey, clearCustomEndpointKey, getAllCustomEndpointKeys (+1) |
| `src/modules/settings/store.ts` | setOpenrouterModelId, emitKeysChanged, clampBgOpacity, setBackgroundOpacity, setShortcuts |
| `src/settings/sections/ShortcutsSection.tsx` | onRecord, onClear, onResetShortcut, onResetAll, onDown |
| `src/settings/sections/ThemesSection.tsx` | ThemesSection, onCreateTheme, onEditTheme, Label |
| `src/modules/ai/store/agentsStore.ts` | useAgentsStore |
| `src/modules/ai/store/snippetsStore.ts` | useSnippetsStore |
| `src/modules/theme/themeFiles.ts` | emitThemeEdit |
| `src/modules/theme/themes/index.ts` | listBuiltinThemes |

## Entry Points

Start here when exploring this area:

- **`getCustomEndpointKey`** (Function) — `src/modules/ai/lib/keyring.ts:97`
- **`setCustomEndpointKey`** (Function) — `src/modules/ai/lib/keyring.ts:111`
- **`clearCustomEndpointKey`** (Function) — `src/modules/ai/lib/keyring.ts:124`
- **`getAllCustomEndpointKeys`** (Function) — `src/modules/ai/lib/keyring.ts:135`
- **`accounts`** (Function) — `src/modules/ai/lib/keyring.ts:141`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `getCustomEndpointKey` | Function | `src/modules/ai/lib/keyring.ts` | 97 |
| `setCustomEndpointKey` | Function | `src/modules/ai/lib/keyring.ts` | 111 |
| `clearCustomEndpointKey` | Function | `src/modules/ai/lib/keyring.ts` | 124 |
| `getAllCustomEndpointKeys` | Function | `src/modules/ai/lib/keyring.ts` | 135 |
| `accounts` | Function | `src/modules/ai/lib/keyring.ts` | 141 |
| `setOpenrouterModelId` | Function | `src/modules/settings/store.ts` | 455 |
| `emitKeysChanged` | Function | `src/modules/settings/store.ts` | 616 |
| `ModelsSection` | Function | `src/settings/sections/ModelsSection.tsx` | 131 |
| `onClearKey` | Function | `src/settings/sections/ModelsSection.tsx` | 165 |
| `onSaveEndpointKey` | Function | `src/settings/sections/ModelsSection.tsx` | 171 |
| `onClearEndpointKey` | Function | `src/settings/sections/ModelsSection.tsx` | 177 |
| `localConfig` | Function | `src/settings/sections/ModelsSection.tsx` | 238 |
| `isConfigured` | Function | `src/settings/sections/ModelsSection.tsx` | 283 |
| `removeProvider` | Function | `src/settings/sections/ModelsSection.tsx` | 310 |
| `useAgentsStore` | Function | `src/modules/ai/store/agentsStore.ts` | 31 |
| `useSnippetsStore` | Function | `src/modules/ai/store/snippetsStore.ts` | 21 |
| `AgentsSection` | Function | `src/settings/sections/AgentsSection.tsx` | 49 |
| `setActiveAgentId` | Function | `src/settings/sections/AgentsSection.tsx` | 53 |
| `upsertAgent` | Function | `src/settings/sections/AgentsSection.tsx` | 54 |
| `removeAgent` | Function | `src/settings/sections/AgentsSection.tsx` | 55 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ModelsSection → ProviderNeedsKey` | cross_community | 5 |
| `ModelsSection → GetProvider` | cross_community | 5 |
| `ModelsSection → CompatKeyringAccount` | intra_community | 4 |
| `Reload → CompatKeyringAccount` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Ui | 18 calls |
| Settings | 8 calls |
| Components | 7 calls |
| Theme | 6 calls |
| Ai | 4 calls |
| Updater | 3 calls |
| Editor | 1 calls |
| App | 1 calls |

## How to Explore

1. `gitnexus_context({name: "getCustomEndpointKey"})` — see callers and callees
2. `gitnexus_query({query: "sections"})` — find related execution flows
3. Read key files listed above for implementation details
