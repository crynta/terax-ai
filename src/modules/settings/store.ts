import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_MODEL_ID,
  LMSTUDIO_DEFAULT_BASE_URL,
  MLX_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  type AutocompleteProviderId,
  type ModelId,
} from "@/modules/ai/config";
import type { KeyBinding, ShortcutId } from "@/modules/shortcuts/shortcuts";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";

export type ThemePref = "system" | "light" | "dark";

export const DEFAULT_THEME_ID = "terax-default";

export type BackgroundKind = "none" | "image";

export const EDITOR_THEMES = [
  "atomone",
  "aura",
  "copilot",
  "github-dark",
  "github-light",
  "gruvbox-dark",
  "nord",
  "tokyo-night",
  "xcode-dark",
  "xcode-light",
] as const;

export type EditorThemeId = (typeof EDITOR_THEMES)[number];

export const EDITOR_THEME_LABELS: Record<EditorThemeId, string> = {
  atomone: "Atom One",
  aura: "Aura",
  copilot: "Copilot",
  "github-dark": "GitHub Dark",
  "github-light": "GitHub Light",
  "gruvbox-dark": "Gruvbox Dark",
  nord: "Nord",
  "tokyo-night": "Tokyo Night",
  "xcode-dark": "Xcode Dark",
  "xcode-light": "Xcode Light",
};

export type Preferences = {
  theme: ThemePref;
  themeId: string;
  backgroundKind: BackgroundKind;
  backgroundImageId: string | null;
  backgroundOpacity: number;
  backgroundBlur: number;
  defaultModelId: ModelId;
  editorTheme: EditorThemeId;
  customInstructions: string;
  autostart: boolean;
  restoreWindowState: boolean;
  autocompleteEnabled: boolean;
  autocompleteProvider: AutocompleteProviderId;
  autocompleteModelId: string;
  lmstudioBaseURL: string;
  lmstudioModelId: string;
  mlxBaseURL: string;
  mlxModelId: string;
  ollamaBaseURL: string;
  ollamaModelId: string;
  openaiCompatibleBaseURL: string;
  openaiCompatibleModelId: string;
  openaiCompatibleContextLimit: number;
  favoriteModelIds: string[];
  recentModelIds: string[];
  vimMode: boolean;
  showHidden: boolean;
  terminalWebglEnabled: boolean;
  terminalFontFamily: string;
  terminalLetterSpacing: number;
  terminalFontSize: number;
  terminalScrollback: number;
  lastWslDistro: string | null;
  zoomLevel: number;
  shortcuts: Record<ShortcutId, KeyBinding[]>;
  sidebarPanelExplorer: boolean;
  sidebarPanelSourceControl: boolean;
  sidebarPanelTabs: boolean;
  sidebarPanelSearch: boolean;
  sidebarPanelOutline: boolean;
  sidebarPanelRecent: boolean;
};

const STORE_PATH = "terax-settings.json";
const KEY_THEME = "theme";
const KEY_THEME_ID = "themeId";
const KEY_BG_KIND = "backgroundKind";
const KEY_BG_IMAGE_ID = "backgroundImageId";
const KEY_BG_OPACITY = "backgroundOpacity";
const KEY_BG_BLUR = "backgroundBlur";
const KEY_DEFAULT_MODEL = "defaultModelId";
const KEY_EDITOR_THEME = "editorTheme";
const KEY_CUSTOM_INSTRUCTIONS = "customInstructions";
const KEY_AUTOSTART = "autostart";
const KEY_RESTORE_WINDOW = "restoreWindowState";
const KEY_AUTOCOMPLETE_ENABLED = "autocompleteEnabled";
const KEY_AUTOCOMPLETE_PROVIDER = "autocompleteProvider";
const KEY_AUTOCOMPLETE_MODEL = "autocompleteModelId";
const KEY_LMSTUDIO_BASE_URL = "lmstudioBaseURL";
const KEY_LMSTUDIO_MODEL_ID = "lmstudioModelId";
const KEY_MLX_BASE_URL = "mlxBaseURL";
const KEY_MLX_MODEL_ID = "mlxModelId";
const KEY_OLLAMA_BASE_URL = "ollamaBaseURL";
const KEY_OLLAMA_MODEL_ID = "ollamaModelId";
const KEY_OPENAI_COMPAT_BASE_URL = "openaiCompatibleBaseURL";
const KEY_OPENAI_COMPAT_MODEL_ID = "openaiCompatibleModelId";
const KEY_OPENAI_COMPAT_CONTEXT_LIMIT = "openaiCompatibleContextLimit";
const KEY_FAVORITE_MODELS = "favoriteModelIds";
const KEY_RECENT_MODELS = "recentModelIds";
const KEY_VIM_MODE = "vimMode";
const KEY_SHOW_HIDDEN = "showHidden";
const LEGACY_KEY_SHOW_HIDDEN_DIRS = "showHiddenDirectories";
const KEY_TERMINAL_WEBGL_ENABLED = "terminalWebglEnabled";
const KEY_TERMINAL_FONT_FAMILY = "terminalFontFamily";
const KEY_TERMINAL_LETTER_SPACING = "terminalLetterSpacing";
const KEY_TERMINAL_FONT_SIZE = "terminalFontSize";
const KEY_TERMINAL_SCROLLBACK = "terminalScrollback";
const KEY_LAST_WSL_DISTRO = "lastWslDistro";
const KEY_ZOOM_LEVEL = "zoomLevel";
const KEY_SHORTCUTS = "shortcuts";
const KEY_SIDEBAR_PANEL_EXPLORER = "sidebarPanelExplorer";
const KEY_SIDEBAR_PANEL_SOURCE_CONTROL = "sidebarPanelSourceControl";
const KEY_SIDEBAR_PANEL_TABS = "sidebarPanelTabs";
const KEY_SIDEBAR_PANEL_SEARCH = "sidebarPanelSearch";
const KEY_SIDEBAR_PANEL_OUTLINE = "sidebarPanelOutline";
const KEY_SIDEBAR_PANEL_RECENT = "sidebarPanelRecent";

export const TERMINAL_FONT_SIZE_DEFAULT = 14;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const TERMINAL_FONT_SIZES = [
  10, 12, 13, 14, 15, 16, 18, 20, 22, 24,
] as const;

export const TERMINAL_SCROLLBACK_DEFAULT = 2000;
export const TERMINAL_SCROLLBACK_MIN = 200;
export const TERMINAL_SCROLLBACK_MAX = 50_000;
export const TERMINAL_SCROLLBACK_PRESETS = [
  500, 1000, 2000, 5000, 10_000, 25_000,
] as const;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  themeId: DEFAULT_THEME_ID,
  backgroundKind: "none",
  backgroundImageId: null,
  backgroundOpacity: 0.5,
  backgroundBlur: 0,
  defaultModelId: DEFAULT_MODEL_ID,
  editorTheme: "atomone",
  customInstructions: "",
  autostart: false,
  restoreWindowState: true,
  autocompleteEnabled: false,
  autocompleteProvider: "cerebras",
  autocompleteModelId: DEFAULT_AUTOCOMPLETE_MODEL.cerebras ?? "",
  lmstudioBaseURL: LMSTUDIO_DEFAULT_BASE_URL,
  lmstudioModelId: "",
  mlxBaseURL: MLX_DEFAULT_BASE_URL,
  mlxModelId: "",
  ollamaBaseURL: OLLAMA_DEFAULT_BASE_URL,
  ollamaModelId: "",
  openaiCompatibleBaseURL: OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  openaiCompatibleModelId: "",
  openaiCompatibleContextLimit: 128_000,
  favoriteModelIds: [],
  recentModelIds: [],
  vimMode: false,
  showHidden: false,
  terminalWebglEnabled: true,
  terminalFontFamily: "",
  terminalLetterSpacing: 0,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalScrollback: TERMINAL_SCROLLBACK_DEFAULT,
  lastWslDistro: null,
  zoomLevel: 1.0,
  shortcuts: {} as Record<ShortcutId, KeyBinding[]>,
  sidebarPanelExplorer: true,
  sidebarPanelSourceControl: true,
  sidebarPanelTabs: true,
  sidebarPanelSearch: false,
  sidebarPanelOutline: false,
  sidebarPanelRecent: false,
};

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

// LazyStore.onChange only fires within the writing process. The settings
// page lives in a separate webview, so writes there never reach the main
// window's subscribers. Mirror every setter through a Tauri event so any
// window can listen.
const PREFS_CHANGED_EVENT = "terax://prefs-changed";

async function writePref<T>(key: string, value: T): Promise<void> {
  await store.set(key, value);
  await store.save();
  await emit(PREFS_CHANGED_EVENT, { key, value });
}

export async function loadPreferences(): Promise<Preferences> {
  // Single IPC roundtrip — fetching keys individually fans out to one
  // `plugin:store|get` per setting and is the dominant boot cost.
  const entries = await store.entries();
  const map = new Map<string, unknown>(entries);
  const get = <T>(k: string): T | undefined => map.get(k) as T | undefined;
  return {
    theme: get<ThemePref>(KEY_THEME) ?? DEFAULT_PREFERENCES.theme,
    themeId: get<string>(KEY_THEME_ID) ?? DEFAULT_PREFERENCES.themeId,
    backgroundKind:
      get<BackgroundKind>(KEY_BG_KIND) ?? DEFAULT_PREFERENCES.backgroundKind,
    backgroundImageId:
      get<string | null>(KEY_BG_IMAGE_ID) ??
      DEFAULT_PREFERENCES.backgroundImageId,
    backgroundOpacity: clampBgOpacity(
      get<number>(KEY_BG_OPACITY) ?? DEFAULT_PREFERENCES.backgroundOpacity,
    ),
    backgroundBlur: clampBlur(
      get<number>(KEY_BG_BLUR) ?? DEFAULT_PREFERENCES.backgroundBlur,
    ),
    defaultModelId:
      get<ModelId>(KEY_DEFAULT_MODEL) ?? DEFAULT_PREFERENCES.defaultModelId,
    editorTheme:
      get<EditorThemeId>(KEY_EDITOR_THEME) ?? DEFAULT_PREFERENCES.editorTheme,
    customInstructions:
      get<string>(KEY_CUSTOM_INSTRUCTIONS) ??
      DEFAULT_PREFERENCES.customInstructions,
    autostart: get<boolean>(KEY_AUTOSTART) ?? DEFAULT_PREFERENCES.autostart,
    restoreWindowState:
      get<boolean>(KEY_RESTORE_WINDOW) ??
      DEFAULT_PREFERENCES.restoreWindowState,
    autocompleteEnabled:
      get<boolean>(KEY_AUTOCOMPLETE_ENABLED) ??
      DEFAULT_PREFERENCES.autocompleteEnabled,
    autocompleteProvider:
      get<AutocompleteProviderId>(KEY_AUTOCOMPLETE_PROVIDER) ??
      DEFAULT_PREFERENCES.autocompleteProvider,
    autocompleteModelId:
      get<string>(KEY_AUTOCOMPLETE_MODEL) ??
      DEFAULT_PREFERENCES.autocompleteModelId,
    lmstudioBaseURL:
      get<string>(KEY_LMSTUDIO_BASE_URL) ?? DEFAULT_PREFERENCES.lmstudioBaseURL,
    lmstudioModelId:
      get<string>(KEY_LMSTUDIO_MODEL_ID) ?? DEFAULT_PREFERENCES.lmstudioModelId,
    mlxBaseURL:
      get<string>(KEY_MLX_BASE_URL) ?? DEFAULT_PREFERENCES.mlxBaseURL,
    mlxModelId:
      get<string>(KEY_MLX_MODEL_ID) ?? DEFAULT_PREFERENCES.mlxModelId,
    ollamaBaseURL:
      get<string>(KEY_OLLAMA_BASE_URL) ?? DEFAULT_PREFERENCES.ollamaBaseURL,
    ollamaModelId:
      get<string>(KEY_OLLAMA_MODEL_ID) ?? DEFAULT_PREFERENCES.ollamaModelId,
    openaiCompatibleBaseURL:
      get<string>(KEY_OPENAI_COMPAT_BASE_URL) ??
      DEFAULT_PREFERENCES.openaiCompatibleBaseURL,
    openaiCompatibleModelId:
      get<string>(KEY_OPENAI_COMPAT_MODEL_ID) ??
      DEFAULT_PREFERENCES.openaiCompatibleModelId,
    openaiCompatibleContextLimit:
      get<number>(KEY_OPENAI_COMPAT_CONTEXT_LIMIT) ??
      DEFAULT_PREFERENCES.openaiCompatibleContextLimit,
    favoriteModelIds:
      get<string[]>(KEY_FAVORITE_MODELS) ??
      DEFAULT_PREFERENCES.favoriteModelIds,
    recentModelIds:
      get<string[]>(KEY_RECENT_MODELS) ?? DEFAULT_PREFERENCES.recentModelIds,
    vimMode: get<boolean>(KEY_VIM_MODE) ?? DEFAULT_PREFERENCES.vimMode,
    showHidden:
      get<boolean>(KEY_SHOW_HIDDEN) ??
      get<boolean>(LEGACY_KEY_SHOW_HIDDEN_DIRS) ??
      DEFAULT_PREFERENCES.showHidden,
    terminalWebglEnabled:
      get<boolean>(KEY_TERMINAL_WEBGL_ENABLED) ??
      DEFAULT_PREFERENCES.terminalWebglEnabled,
    terminalFontFamily:
      get<string>(KEY_TERMINAL_FONT_FAMILY) ??
      DEFAULT_PREFERENCES.terminalFontFamily,
    terminalLetterSpacing:
      get<number>(KEY_TERMINAL_LETTER_SPACING) ??
      DEFAULT_PREFERENCES.terminalLetterSpacing,
    terminalFontSize:
      get<number>(KEY_TERMINAL_FONT_SIZE) ??
      DEFAULT_PREFERENCES.terminalFontSize,
    terminalScrollback: clampScrollback(
      get<number>(KEY_TERMINAL_SCROLLBACK) ??
        DEFAULT_PREFERENCES.terminalScrollback,
    ),
    lastWslDistro:
      get<string | null>(KEY_LAST_WSL_DISTRO) ??
      DEFAULT_PREFERENCES.lastWslDistro,
    zoomLevel: get<number>(KEY_ZOOM_LEVEL) ?? DEFAULT_PREFERENCES.zoomLevel,
    shortcuts:
      get<Record<ShortcutId, KeyBinding[]>>(KEY_SHORTCUTS) ??
      DEFAULT_PREFERENCES.shortcuts,
    sidebarPanelExplorer:
      get<boolean>(KEY_SIDEBAR_PANEL_EXPLORER) ?? DEFAULT_PREFERENCES.sidebarPanelExplorer,
    sidebarPanelSourceControl:
      get<boolean>(KEY_SIDEBAR_PANEL_SOURCE_CONTROL) ?? DEFAULT_PREFERENCES.sidebarPanelSourceControl,
    sidebarPanelTabs:
      get<boolean>(KEY_SIDEBAR_PANEL_TABS) ?? DEFAULT_PREFERENCES.sidebarPanelTabs,
    sidebarPanelSearch:
      get<boolean>(KEY_SIDEBAR_PANEL_SEARCH) ?? DEFAULT_PREFERENCES.sidebarPanelSearch,
    sidebarPanelOutline:
      get<boolean>(KEY_SIDEBAR_PANEL_OUTLINE) ?? DEFAULT_PREFERENCES.sidebarPanelOutline,
    sidebarPanelRecent:
      get<boolean>(KEY_SIDEBAR_PANEL_RECENT) ?? DEFAULT_PREFERENCES.sidebarPanelRecent,
  };
}

export async function setTheme(value: ThemePref): Promise<void> {
  await writePref(KEY_THEME, value);
}

export async function setThemeId(value: string): Promise<void> {
  await writePref(KEY_THEME_ID, value);
}

/** Slider stores 0..1. Actual rendered opacity is halved in SurfaceLayer
 *  so the image never exceeds 50% — keeps UI/terminal readable at any setting. */
export const BG_OPACITY_RENDER_FACTOR = 0.5;

function clampBgOpacity(v: number): number {
  if (!Number.isFinite(v)) return 0.7;
  return Math.min(1, Math.max(0, v));
}

function clampBlur(v: number): number {
  if (!Number.isFinite(v)) return 16;
  return Math.min(64, Math.max(0, Math.round(v)));
}

export async function setBackgroundKind(value: BackgroundKind): Promise<void> {
  await writePref(KEY_BG_KIND, value);
}

export async function setBackgroundImageId(value: string | null): Promise<void> {
  await writePref(KEY_BG_IMAGE_ID, value);
}

export async function setBackgroundOpacity(value: number): Promise<void> {
  await writePref(KEY_BG_OPACITY, clampBgOpacity(value));
}

export async function setBackgroundBlur(value: number): Promise<void> {
  await writePref(KEY_BG_BLUR, clampBlur(value));
}


export async function setDefaultModel(value: ModelId): Promise<void> {
  await writePref(KEY_DEFAULT_MODEL, value);
}

export async function setEditorTheme(value: EditorThemeId): Promise<void> {
  await writePref(KEY_EDITOR_THEME, value);
}

export async function setCustomInstructions(value: string): Promise<void> {
  await writePref(KEY_CUSTOM_INSTRUCTIONS, value);
}

export async function setAutostart(value: boolean): Promise<void> {
  await writePref(KEY_AUTOSTART, value);
}

export async function setRestoreWindowState(value: boolean): Promise<void> {
  await writePref(KEY_RESTORE_WINDOW, value);
}

export async function setAutocompleteEnabled(value: boolean): Promise<void> {
  await writePref(KEY_AUTOCOMPLETE_ENABLED, value);
}

export async function setAutocompleteProvider(
  value: AutocompleteProviderId,
): Promise<void> {
  await writePref(KEY_AUTOCOMPLETE_PROVIDER, value);
}

export async function setAutocompleteModelId(value: string): Promise<void> {
  await writePref(KEY_AUTOCOMPLETE_MODEL, value);
}

export async function setLmstudioBaseURL(value: string): Promise<void> {
  await writePref(KEY_LMSTUDIO_BASE_URL, value);
}

export async function setLmstudioModelId(value: string): Promise<void> {
  await writePref(KEY_LMSTUDIO_MODEL_ID, value);
}

export async function setMlxBaseURL(value: string): Promise<void> {
  await writePref(KEY_MLX_BASE_URL, value);
}

export async function setMlxModelId(value: string): Promise<void> {
  await writePref(KEY_MLX_MODEL_ID, value);
}

export async function setOllamaBaseURL(value: string): Promise<void> {
  await writePref(KEY_OLLAMA_BASE_URL, value);
}

export async function setOllamaModelId(value: string): Promise<void> {
  await writePref(KEY_OLLAMA_MODEL_ID, value);
}

export async function setOpenaiCompatibleBaseURL(value: string): Promise<void> {
  await writePref(KEY_OPENAI_COMPAT_BASE_URL, value);
}

export async function setOpenaiCompatibleModelId(value: string): Promise<void> {
  await writePref(KEY_OPENAI_COMPAT_MODEL_ID, value);
}

export async function setOpenaiCompatibleContextLimit(
  value: number,
): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.max(1_000, Math.round(value))
    : DEFAULT_PREFERENCES.openaiCompatibleContextLimit;
  await writePref(KEY_OPENAI_COMPAT_CONTEXT_LIMIT, clamped);
}

export async function setFavoriteModelIds(value: string[]): Promise<void> {
  await writePref(KEY_FAVORITE_MODELS, value);
}

export async function setRecentModelIds(value: string[]): Promise<void> {
  await writePref(KEY_RECENT_MODELS, value);
}

export async function setVimMode(value: boolean): Promise<void> {
  await writePref(KEY_VIM_MODE, value);
}

export async function setShowHidden(value: boolean): Promise<void> {
  await writePref(KEY_SHOW_HIDDEN, value);
}

export async function setTerminalWebglEnabled(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_WEBGL_ENABLED, value);
}

export async function setTerminalFontFamily(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_FAMILY, value.trim());
}

export async function setTerminalLetterSpacing(value: number): Promise<void> {
  const clamped = Number.isFinite(value) ? Math.max(-10, Math.min(10, Math.round(value))) : 0;
  await writePref(KEY_TERMINAL_LETTER_SPACING, clamped);
}

export async function setTerminalFontSize(value: number): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.min(
        TERMINAL_FONT_SIZE_MAX,
        Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(value)),
      )
    : TERMINAL_FONT_SIZE_DEFAULT;
  await writePref(KEY_TERMINAL_FONT_SIZE, clamped);
}

function clampScrollback(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_SCROLLBACK_DEFAULT;
  return Math.min(
    TERMINAL_SCROLLBACK_MAX,
    Math.max(TERMINAL_SCROLLBACK_MIN, Math.round(value)),
  );
}

export async function setTerminalScrollback(value: number): Promise<void> {
  await writePref(KEY_TERMINAL_SCROLLBACK, clampScrollback(value));
}

export async function setLastWslDistro(value: string | null): Promise<void> {
  await writePref(KEY_LAST_WSL_DISTRO, value);
}

export async function setZoomLevel(value: number): Promise<void> {
  await writePref(KEY_ZOOM_LEVEL, value);
}

export async function setShortcuts(
  value: Record<ShortcutId, KeyBinding[]> | {},
): Promise<void> {
  await writePref(KEY_SHORTCUTS, value);
}

export async function resetShortcuts(): Promise<void> {
  await writePref(KEY_SHORTCUTS, DEFAULT_PREFERENCES.shortcuts);
}

export async function setSidebarPanelExplorer(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_EXPLORER, value);
}
export async function setSidebarPanelSourceControl(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_SOURCE_CONTROL, value);
}
export async function setSidebarPanelTabs(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_TABS, value);
}
export async function setSidebarPanelSearch(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_SEARCH, value);
}
export async function setSidebarPanelOutline(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_OUTLINE, value);
}
export async function setSidebarPanelRecent(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_PANEL_RECENT, value);
}

export type PrefKey = keyof Preferences;

/** Subscribe to changes from any window (settings → main). */
export async function onPreferencesChange(
  cb: (key: PrefKey, value: unknown) => void,
): Promise<UnlistenFn> {
  const map: Record<string, PrefKey> = {
    [KEY_THEME]: "theme",
    [KEY_THEME_ID]: "themeId",
    [KEY_BG_KIND]: "backgroundKind",
    [KEY_BG_IMAGE_ID]: "backgroundImageId",
    [KEY_BG_OPACITY]: "backgroundOpacity",
    [KEY_BG_BLUR]: "backgroundBlur",
    [KEY_DEFAULT_MODEL]: "defaultModelId",
    [KEY_EDITOR_THEME]: "editorTheme",
    [KEY_CUSTOM_INSTRUCTIONS]: "customInstructions",
    [KEY_AUTOSTART]: "autostart",
    [KEY_RESTORE_WINDOW]: "restoreWindowState",
    [KEY_AUTOCOMPLETE_ENABLED]: "autocompleteEnabled",
    [KEY_AUTOCOMPLETE_PROVIDER]: "autocompleteProvider",
    [KEY_AUTOCOMPLETE_MODEL]: "autocompleteModelId",
    [KEY_LMSTUDIO_BASE_URL]: "lmstudioBaseURL",
    [KEY_LMSTUDIO_MODEL_ID]: "lmstudioModelId",
    [KEY_MLX_BASE_URL]: "mlxBaseURL",
    [KEY_MLX_MODEL_ID]: "mlxModelId",
    [KEY_OLLAMA_BASE_URL]: "ollamaBaseURL",
    [KEY_OLLAMA_MODEL_ID]: "ollamaModelId",
    [KEY_OPENAI_COMPAT_BASE_URL]: "openaiCompatibleBaseURL",
    [KEY_OPENAI_COMPAT_MODEL_ID]: "openaiCompatibleModelId",
    [KEY_OPENAI_COMPAT_CONTEXT_LIMIT]: "openaiCompatibleContextLimit",
    [KEY_FAVORITE_MODELS]: "favoriteModelIds",
    [KEY_RECENT_MODELS]: "recentModelIds",
    [KEY_VIM_MODE]: "vimMode",
    [KEY_SHOW_HIDDEN]: "showHidden",
    [KEY_TERMINAL_WEBGL_ENABLED]: "terminalWebglEnabled",
    [KEY_TERMINAL_FONT_FAMILY]: "terminalFontFamily",
    [KEY_TERMINAL_LETTER_SPACING]: "terminalLetterSpacing",
    [KEY_TERMINAL_FONT_SIZE]: "terminalFontSize",
    [KEY_TERMINAL_SCROLLBACK]: "terminalScrollback",
    [KEY_LAST_WSL_DISTRO]: "lastWslDistro",
    [KEY_ZOOM_LEVEL]: "zoomLevel",
    [KEY_SHORTCUTS]: "shortcuts",
    [KEY_SIDEBAR_PANEL_EXPLORER]: "sidebarPanelExplorer",
    [KEY_SIDEBAR_PANEL_SOURCE_CONTROL]: "sidebarPanelSourceControl",
    [KEY_SIDEBAR_PANEL_TABS]: "sidebarPanelTabs",
    [KEY_SIDEBAR_PANEL_SEARCH]: "sidebarPanelSearch",
    [KEY_SIDEBAR_PANEL_OUTLINE]: "sidebarPanelOutline",
    [KEY_SIDEBAR_PANEL_RECENT]: "sidebarPanelRecent",
  };
  // Same-process writes still fire onChange immediately; cross-window writes
  // arrive via the Tauri event emitted by writePref().
  const unsubLocal = await store.onChange<unknown>((key, value) => {
    const mapped = map[key];
    if (mapped) cb(mapped, value);
  });
  const unsubEvent = await listen<{ key: string; value: unknown }>(
    PREFS_CHANGED_EVENT,
    (e) => {
      const mapped = map[e.payload.key];
      if (mapped) cb(mapped, e.payload.value);
    },
  );
  return () => {
    unsubLocal();
    unsubEvent();
  };
}

// API key changes are stored in OS keychain (not the prefs store),
// so we broadcast via a Tauri event for cross-window listeners.
const KEYS_CHANGED_EVENT = "terax://ai-keys-changed";

export async function emitKeysChanged(): Promise<void> {
  await emit(KEYS_CHANGED_EVENT);
}

export function onKeysChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(KEYS_CHANGED_EVENT, () => cb());
}
