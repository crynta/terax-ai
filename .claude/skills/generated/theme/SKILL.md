---
name: theme
description: "Skill for the Theme area of terax-ai. 52 symbols across 13 files."
---

# Theme

52 symbols | 13 files | Cohesion: 65%

## When to Use

- Working with code in `src/`
- Understanding how setEditorTheme, onCustomThemesChange, getBuiltinTheme work
- Modifying theme-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/modules/theme/ThemeProvider.tsx` | readFastMode, readFastThemeId, resolveTheme, ThemeProvider, writeFastMode (+5) |
| `src/modules/theme/bgImageStore.ts` | openDb, putBgImage, getBgImage, formatBytes, isAnimated (+2) |
| `src/modules/theme/validateTheme.ts` | isObj, isStr, parseColors, parseTerminal, parseVariant (+1) |
| `src/modules/theme/themeFiles.ts` | isThemeFilePath, parseThemeFile, themesDir, themeFilePath, writeThemeFile (+1) |
| `src/modules/theme/customThemes.ts` | onCustomThemesChange, saveCustomTheme, listCustomThemes, deleteCustomTheme |
| `src/modules/theme/SurfaceLayer.tsx` | SurfaceLayer, BackgroundImage, useWindowResizing, useDocumentHidden |
| `src/modules/theme/applyTheme.ts` | applyTheme, clearTheme, writeColors, writeTerminal |
| `src/modules/settings/store.ts` | setEditorTheme, setTheme, setThemeId |
| `src/modules/theme/themes/index.ts` | getBuiltinTheme, getDefaultTheme |
| `src/lib/useZoom.ts` | applyToDom, useZoom |

## Entry Points

Start here when exploring this area:

- **`setEditorTheme`** (Function) — `src/modules/settings/store.ts:378`
- **`onCustomThemesChange`** (Function) — `src/modules/theme/customThemes.ts:32`
- **`getBuiltinTheme`** (Function) — `src/modules/theme/themes/index.ts:31`
- **`getDefaultTheme`** (Function) — `src/modules/theme/themes/index.ts:35`
- **`ThemeProvider`** (Function) — `src/modules/theme/ThemeProvider.tsx:74`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `setEditorTheme` | Function | `src/modules/settings/store.ts` | 378 |
| `onCustomThemesChange` | Function | `src/modules/theme/customThemes.ts` | 32 |
| `getBuiltinTheme` | Function | `src/modules/theme/themes/index.ts` | 31 |
| `getDefaultTheme` | Function | `src/modules/theme/themes/index.ts` | 35 |
| `ThemeProvider` | Function | `src/modules/theme/ThemeProvider.tsx` | 74 |
| `useZoom` | Function | `src/lib/useZoom.ts` | 18 |
| `usePreferencesStore` | Function | `src/modules/settings/preferences.ts` | 47 |
| `SurfaceLayer` | Function | `src/modules/theme/SurfaceLayer.tsx` | 12 |
| `setTheme` | Function | `src/modules/settings/store.ts` | 335 |
| `setThemeId` | Function | `src/modules/settings/store.ts` | 339 |
| `unlistenP` | Function | `src/modules/theme/ThemeProvider.tsx` | 93 |
| `setMode` | Function | `src/modules/theme/ThemeProvider.tsx` | 156 |
| `setThemeId` | Function | `src/modules/theme/ThemeProvider.tsx` | 162 |
| `putBgImage` | Function | `src/modules/theme/bgImageStore.ts` | 30 |
| `getBgImage` | Function | `src/modules/theme/bgImageStore.ts` | 50 |
| `importBgImageFromFile` | Function | `src/modules/theme/bgImageStore.ts` | 102 |
| `validateTheme` | Function | `src/modules/theme/validateTheme.ts` | 93 |
| `saveCustomTheme` | Function | `src/modules/theme/customThemes.ts` | 15 |
| `isThemeFilePath` | Function | `src/modules/theme/themeFiles.ts` | 14 |
| `parseThemeFile` | Function | `src/modules/theme/themeFiles.ts` | 54 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `UnlistenPromise → IsObj` | cross_community | 6 |
| `UnlistenPromise → IsStr` | cross_community | 6 |
| `EditorStack → UsePreferencesStore` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Settings | 5 calls |
| Workspace | 3 calls |

## How to Explore

1. `gitnexus_context({name: "setEditorTheme"})` — see callers and callees
2. `gitnexus_query({query: "theme"})` — find related execution flows
3. Read key files listed above for implementation details
