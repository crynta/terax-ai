import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_MODEL_ID,
  LMSTUDIO_DEFAULT_BASE_URL,
  type AutocompleteProviderId,
} from "@/modules/ai/config";

export type ThemePref = "system" | "light" | "dark";

export const EDITOR_THEMES = [
  "atomone",
  "aura",
  "copilot",
  "github-dark",
  "github-light",
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
  nord: "Nord",
  "tokyo-night": "Tokyo Night",
  "xcode-dark": "Xcode Dark",
  "xcode-light": "Xcode Light",
};

export type Preferences = {
  theme: ThemePref;
  defaultModelId: string;
  editorTheme: EditorThemeId;
  customInstructions: string;
  autostart: boolean;
  restoreWindowState: boolean;
  autocompleteEnabled: boolean;
  autocompleteProvider: AutocompleteProviderId;
  autocompleteModelId: string;
  lmstudioBaseURL: string;
  vimMode: boolean;
  openrouterFavorites: string[];
};

const STORE_PATH = "terax-settings.json";
const KEY_THEME = "theme";
const KEY_DEFAULT_MODEL = "defaultModelId";
const KEY_EDITOR_THEME = "editorTheme";
const KEY_CUSTOM_INSTRUCTIONS = "customInstructions";
const KEY_AUTOSTART = "autostart";
const KEY_RESTORE_WINDOW = "restoreWindowState";
const KEY_AUTOCOMPLETE_ENABLED = "autocompleteEnabled";
const KEY_AUTOCOMPLETE_PROVIDER = "autocompleteProvider";
const KEY_AUTOCOMPLETE_MODEL = "autocompleteModelId";
const KEY_LMSTUDIO_BASE_URL = "lmstudioBaseURL";
const KEY_VIM_MODE = "vimMode";
const KEY_OPENROUTER_FAVORITES = "openrouterFavorites";

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  defaultModelId: DEFAULT_MODEL_ID,
  editorTheme: "atomone",
  customInstructions: "",
  autostart: false,
  restoreWindowState: true,
  autocompleteEnabled: false,
  autocompleteProvider: "cerebras",
  autocompleteModelId: DEFAULT_AUTOCOMPLETE_MODEL.cerebras,
  lmstudioBaseURL: LMSTUDIO_DEFAULT_BASE_URL,
  vimMode: false,
  openrouterFavorites: [],
};

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export async function loadPreferences(): Promise<Preferences> {
  // Single IPC roundtrip — fetching keys individually fans out to one
  // `plugin:store|get` per setting and is the dominant boot cost.
  const entries = await store.entries();
  const map = new Map<string, unknown>(entries);
  const get = <T>(k: string): T | undefined => map.get(k) as T | undefined;
  return {
    theme: get<ThemePref>(KEY_THEME) ?? DEFAULT_PREFERENCES.theme,
    defaultModelId:
      get<string>(KEY_DEFAULT_MODEL) ?? DEFAULT_PREFERENCES.defaultModelId,
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
      get<string>(KEY_LMSTUDIO_BASE_URL) ??
      DEFAULT_PREFERENCES.lmstudioBaseURL,
    vimMode: get<boolean>(KEY_VIM_MODE) ?? DEFAULT_PREFERENCES.vimMode,
    openrouterFavorites:
      get<string[]>(KEY_OPENROUTER_FAVORITES) ??
      DEFAULT_PREFERENCES.openrouterFavorites,
  };
}

export async function setTheme(value: ThemePref): Promise<void> {
  await store.set(KEY_THEME, value);
  await store.save();
}

export async function setDefaultModel(value: string): Promise<void> {
  await store.set(KEY_DEFAULT_MODEL, value);
  await store.save();
}

export async function setEditorTheme(value: EditorThemeId): Promise<void> {
  await store.set(KEY_EDITOR_THEME, value);
  await store.save();
}

export async function setCustomInstructions(value: string): Promise<void> {
  await store.set(KEY_CUSTOM_INSTRUCTIONS, value);
  await store.save();
}

export async function setAutostart(value: boolean): Promise<void> {
  await store.set(KEY_AUTOSTART, value);
  await store.save();
}

export async function setRestoreWindowState(value: boolean): Promise<void> {
  await store.set(KEY_RESTORE_WINDOW, value);
  await store.save();
}

export async function setAutocompleteEnabled(value: boolean): Promise<void> {
  await store.set(KEY_AUTOCOMPLETE_ENABLED, value);
  await store.save();
}

export async function setAutocompleteProvider(
  value: AutocompleteProviderId,
): Promise<void> {
  await store.set(KEY_AUTOCOMPLETE_PROVIDER, value);
  await store.save();
}

export async function setAutocompleteModelId(value: string): Promise<void> {
  await store.set(KEY_AUTOCOMPLETE_MODEL, value);
  await store.save();
}

export async function setLmstudioBaseURL(value: string): Promise<void> {
  await store.set(KEY_LMSTUDIO_BASE_URL, value);
  await store.save();
}

export async function setVimMode(value: boolean): Promise<void> {
  await store.set(KEY_VIM_MODE, value);
  await store.save();
}

export async function setOpenrouterFavorites(value: string[]): Promise<void> {
  await store.set(KEY_OPENROUTER_FAVORITES, value);
  await store.save();
}

export async function toggleOpenrouterFavorite(modelId: string): Promise<void> {
  const current =
    ((await store.get<string[]>(KEY_OPENROUTER_FAVORITES)) ?? []).slice();
  const idx = current.indexOf(modelId);
  if (idx >= 0) current.splice(idx, 1);
  else current.push(modelId);
  await store.set(KEY_OPENROUTER_FAVORITES, current);
  await store.save();
}

export type PrefKey = keyof Preferences;

/** Subscribe to changes from any window (settings → main). */
export function onPreferencesChange(
  cb: (key: PrefKey, value: unknown) => void,
): Promise<UnlistenFn> {
  const map: Record<string, PrefKey> = {
    [KEY_THEME]: "theme",
    [KEY_DEFAULT_MODEL]: "defaultModelId",
    [KEY_EDITOR_THEME]: "editorTheme",
    [KEY_CUSTOM_INSTRUCTIONS]: "customInstructions",
    [KEY_AUTOSTART]: "autostart",
    [KEY_RESTORE_WINDOW]: "restoreWindowState",
    [KEY_AUTOCOMPLETE_ENABLED]: "autocompleteEnabled",
    [KEY_AUTOCOMPLETE_PROVIDER]: "autocompleteProvider",
    [KEY_AUTOCOMPLETE_MODEL]: "autocompleteModelId",
    [KEY_LMSTUDIO_BASE_URL]: "lmstudioBaseURL",
    [KEY_VIM_MODE]: "vimMode",
    [KEY_OPENROUTER_FAVORITES]: "openrouterFavorites",
  };
  return store.onChange<unknown>((key, value) => {
    const mapped = map[key];
    if (mapped) cb(mapped, value);
  });
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
