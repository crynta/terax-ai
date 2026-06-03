---
name: settings
description: "Skill for the Settings area of terax-ai. 74 symbols across 15 files."
---

# Settings

74 symbols | 15 files | Cohesion: 65%

## When to Use

- Working with code in `src/`
- Understanding how setCustomInstructions, setAutocompleteProvider, setAutocompleteModelId work
- Modifying settings-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/settings/store.ts` | writePref, setCustomInstructions, setAutocompleteProvider, setAutocompleteModelId, setLmstudioBaseURL (+37) |
| `src/settings/sections/ModelsSection.tsx` | setModel, addCustomEndpoint, updateCustomEndpoint, removeCustomEndpoint |
| `src/components/ui/select.tsx` | Select, SelectValue, SelectTrigger, SelectItem |
| `src/settings/sections/GeneralSection.tsx` | GeneralSection, onToggleAutostart, Label, AutoSaveDelayInput |
| `src/lib/useZoom.ts` | clampZoom, zoomIn, zoomOut, zoomReset |
| `src/modules/ai/config.ts` | compatModelIdForEndpoint, migrateLegacyCompatEndpoint, isKnownModelId |
| `src/modules/ai/lib/modelPrefs.ts` | toggleFavoriteModel, pushRecentModel |
| `src/modules/settings/preferences.ts` | mirrorBgFastPath, init |
| `src/settings/sections/ThemesSection.tsx` | handleBgFiles, onRemoveBackground |
| `src/settings/SettingsApp.tsx` | apply, unlistenPromise |

## Entry Points

Start here when exploring this area:

- **`setCustomInstructions`** (Function) — `src/modules/settings/store.ts:382`
- **`setAutocompleteProvider`** (Function) — `src/modules/settings/store.ts:398`
- **`setAutocompleteModelId`** (Function) — `src/modules/settings/store.ts:404`
- **`setLmstudioBaseURL`** (Function) — `src/modules/settings/store.ts:408`
- **`setLmstudioModelId`** (Function) — `src/modules/settings/store.ts:412`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `setCustomInstructions` | Function | `src/modules/settings/store.ts` | 382 |
| `setAutocompleteProvider` | Function | `src/modules/settings/store.ts` | 398 |
| `setAutocompleteModelId` | Function | `src/modules/settings/store.ts` | 404 |
| `setLmstudioBaseURL` | Function | `src/modules/settings/store.ts` | 408 |
| `setLmstudioModelId` | Function | `src/modules/settings/store.ts` | 412 |
| `setMlxBaseURL` | Function | `src/modules/settings/store.ts` | 416 |
| `setMlxModelId` | Function | `src/modules/settings/store.ts` | 420 |
| `setOllamaBaseURL` | Function | `src/modules/settings/store.ts` | 424 |
| `setOllamaModelId` | Function | `src/modules/settings/store.ts` | 428 |
| `setOpenaiCompatibleBaseURL` | Function | `src/modules/settings/store.ts` | 432 |
| `setOpenaiCompatibleModelId` | Function | `src/modules/settings/store.ts` | 436 |
| `setOpenaiCompatibleContextLimit` | Function | `src/modules/settings/store.ts` | 440 |
| `setVimMode` | Function | `src/modules/settings/store.ts` | 467 |
| `setLastWslDistro` | Function | `src/modules/settings/store.ts` | 510 |
| `resetShortcuts` | Function | `src/modules/settings/store.ts` | 541 |
| `setEnv` | Function | `src/modules/workspace/env.ts` | 30 |
| `setAutostart` | Function | `src/modules/settings/store.ts` | 386 |
| `setRestoreWindowState` | Function | `src/modules/settings/store.ts` | 390 |
| `setShowHidden` | Function | `src/modules/settings/store.ts` | 471 |
| `setTerminalWebglEnabled` | Function | `src/modules/settings/store.ts` | 475 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Ui | 11 calls |
| Sections | 4 calls |
| Theme | 3 calls |
| Updater | 1 calls |
| Components | 1 calls |
| Ai | 1 calls |

## How to Explore

1. `gitnexus_context({name: "setCustomInstructions"})` — see callers and callees
2. `gitnexus_query({query: "settings"})` — find related execution flows
3. Read key files listed above for implementation details
