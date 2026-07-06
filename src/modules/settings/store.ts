import {
  type AutocompleteProviderId,
  type CustomEndpoint,
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_MODEL_ID,
  DEFAULT_STT_PROVIDER,
  isKnownModelId,
  LMSTUDIO_DEFAULT_BASE_URL,
  MLX_DEFAULT_BASE_URL,
  type ModelId,
  migrateLegacyCompatEndpoint,
  OLLAMA_DEFAULT_BASE_URL,
  OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  type SttProvider,
  WHISPERCPP_DEFAULT_BASE_URL,
} from "@/modules/ai/config";
import type { KeyBinding, ShortcutId } from "@/modules/shortcuts/shortcuts";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";

export type ThemePref = "system" | "light" | "dark";

export const DEFAULT_THEME_ID = "terax-default";

export type BackgroundKind = "none" | "image";

export const EDITOR_THEMES = [
  "kanagawa",
  "kanagawa-lotus",
  "kanagawa-dragon",
  "tokyo-night",
  "catppuccin-mocha",
  "catppuccin-latte",
  "rose-pine",
  "rose-pine-dawn",
  "everforest",
  "everforest-light",
  "dracula",
  "solarized-dark",
  "solarized-light",
  "nord",
  "gruvbox-dark",
  "atomone",
  "aura",
  "copilot",
  "github-dark",
  "github-light",
  "xcode-dark",
  "xcode-light",
] as const;

export type EditorThemeId = (typeof EDITOR_THEMES)[number];

/** "auto" follows the active app theme's editorTheme pairing (resolved live). */
export const EDITOR_THEME_AUTO = "auto" as const;
export type EditorThemePref = typeof EDITOR_THEME_AUTO | EditorThemeId;

export function isEditorThemeId(v: unknown): v is EditorThemeId {
  return (
    typeof v === "string" && (EDITOR_THEMES as readonly string[]).includes(v)
  );
}

export const EDITOR_THEME_MODE: Record<EditorThemeId, "light" | "dark"> = {
  kanagawa: "dark",
  "kanagawa-lotus": "light",
  "kanagawa-dragon": "dark",
  "tokyo-night": "dark",
  "catppuccin-mocha": "dark",
  "catppuccin-latte": "light",
  "rose-pine": "dark",
  "rose-pine-dawn": "light",
  everforest: "dark",
  "everforest-light": "light",
  dracula: "dark",
  "solarized-dark": "dark",
  "solarized-light": "light",
  nord: "dark",
  "gruvbox-dark": "dark",
  atomone: "dark",
  aura: "dark",
  copilot: "dark",
  "github-dark": "dark",
  "github-light": "light",
  "xcode-dark": "dark",
  "xcode-light": "light",
};

export const EDITOR_THEME_LABELS: Record<EditorThemeId, string> = {
  kanagawa: "Kanagawa Wave",
  "kanagawa-lotus": "Kanagawa Lotus",
  "kanagawa-dragon": "Kanagawa Dragon",
  "tokyo-night": "Tokyo Night",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte",
  "rose-pine": "Rosé Pine",
  "rose-pine-dawn": "Rosé Pine Dawn",
  everforest: "Everforest Dark",
  "everforest-light": "Everforest Light",
  dracula: "Dracula",
  "solarized-dark": "Solarized Dark",
  "solarized-light": "Solarized Light",
  nord: "Nord",
  "gruvbox-dark": "Gruvbox Dark",
  atomone: "Atom One",
  aura: "Aura",
  copilot: "Copilot",
  "github-dark": "GitHub Dark",
  "github-light": "GitHub Light",
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
  editorTheme: EditorThemePref;
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
  customEndpoints: CustomEndpoint[];
  openrouterModelId: string;
  sttProvider: SttProvider;
  groqSttModel: string;
  whispercppBaseURL: string;
  favoriteModelIds: string[];
  recentModelIds: string[];
  vimMode: boolean;
  /** Custom Vim mappings for the code editor (e.g. jj → <Esc> in insert). */
  vimKeymaps: VimKeymap[];
  editorWordWrap: boolean;
  sidebarStartCollapsed: boolean;
  statusBarVisible: boolean;
  /** Launch with the status bar collapsed instead of restoring last state. */
  statusBarStartCollapsed: boolean;
  /** Remove the sidebar entirely: header toggle hidden, shortcut blocked. */
  sidebarDisabled: boolean;
  /** Remove the status bar entirely: reopen controls hidden, shortcut blocked. */
  statusBarDisabled: boolean;
  /** Slide-out keybinding chips on icon hover; off = plain hover only. */
  hoverKeybindHints: boolean;
  animationSpeed: AnimationSpeed;
  /** Duration multiplier used when animationSpeed is "custom". */
  animationSpeedCustom: number;
  showHidden: boolean;
  explorerGitDecorations: boolean;
  terminalWebglEnabled: boolean;
  terminalCursorBlink: boolean;
  terminalFontFamily: string;
  terminalFontWeight: string;
  terminalShell: string;
  terminalLetterSpacing: number;
  terminalFontSize: number;
  terminalScrollback: number;
  /** Inner padding of the terminal content area, px. */
  terminalPadding: number;
  /** Per-side padding; when set it replaces the uniform terminalPadding. */
  terminalPaddingSides: TerminalPaddingSides | null;
  /** Classic-terminal completion menu (history + AI). */
  terminalSuggestEnabled: boolean;
  /** Debounce before the menu opens/updates after typing, ms. */
  terminalSuggestDelayMs: number;
  /** Extra settle time before asking the AI model, ms. */
  terminalSuggestAiDelayMs: number;
  /** Max rows in the completion menu. */
  terminalSuggestMaxItems: number;
  /** Minimum typed characters before suggestions kick in. */
  terminalSuggestMinChars: number;
  /** Terminal tab titles show the running command / TUI name. */
  smartTabTitles: boolean;
  /** Thin progress bar on tabs parsed from command output ("NN%"). */
  tabProgressEnabled: boolean;
  /** Toast when a long command finishes in a hidden tab. */
  commandDoneToasts: boolean;
  /** AI Fix/Explain on failed commands (blocks buttons + classic offer). */
  failedCommandAi: boolean;
  /** "# task" natural-language → command translation at the prompt. */
  nlCommandsEnabled: boolean;
  /** SSH hosts from ~/.ssh/config in the command palette. */
  sshPaletteEnabled: boolean;
  lastWslDistro: string | null;
  zoomLevel: number;
  agentNotifications: boolean;
  defaultWorkspaceEnv: string;
  shortcuts: Record<ShortcutId, KeyBinding[]>;
  editorAutoSave: boolean;
  editorAutoSaveDelay: number;
  editorFormatOnSave: boolean;
  lspActivation: Record<string, LspActivation>;
  lspCustomServers: LspCustomServer[];
  shellTools: ShellTool[];
};

export type AnimationSpeed = "off" | "fast" | "normal" | "slow" | "custom";

/** A TUI recognized inside the terminal (nvim, htop, …). While its command
 *  runs in the focused terminal, per-tool settings override the global ones. */
export type ShellTool = {
  id: string;
  name: string;
  /** Command basenames that activate the tool (argv[0], case-insensitive). */
  patterns: string[];
  /** Legacy all-or-nothing switch; superseded by shortcutMode when set. */
  blockShortcuts: boolean;
  /** Shortcuts while the tool runs: keep "all", pass "none" to the app
   *  (everything goes to the TUI), or "custom" — pass only blockedShortcuts. */
  shortcutMode?: "all" | "none" | "custom";
  /** shortcutMode "custom": app shortcuts handed to the TUI. */
  blockedShortcuts?: ShortcutId[];
  /** Per-tool rebinds: while the tool runs and the terminal is focused,
   *  these key combos replace the global ones for the given shortcut. */
  shortcutOverrides?: Partial<Record<ShortcutId, KeyBinding[]>>;
  /** Collapse the status bar while the tool is in the foreground; "disable"
   *  also removes the reopen controls and blocks the toggle shortcut. */
  hideStatusBar?: boolean | "disable";
  /** Collapse the sidebar while the tool is in the foreground; "disable"
   *  also removes the header toggle and blocks the toggle shortcut. */
  hideSidebar?: boolean | "disable";
  /** Terminal content padding (px) while the tool runs (undefined = global). */
  padding?: number;
  /** Per-side padding while the tool runs; wins over the uniform padding. */
  paddingSides?: TerminalPaddingSides;
  /** Override the global terminal cursor-blink setting (undefined = global). */
  cursorBlink?: "on" | "off";
  /** Terminal font overrides for this tool (undefined = global). */
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  /** With blockShortcuts on, these app shortcuts stay active anyway. */
  allowedShortcuts?: ShortcutId[];
};

export type ChromeHideMode = "off" | "hide" | "disable";

/** Normalizes a ShellTool hide flag (legacy boolean or "disable"). */
export function chromeHideMode(
  v: boolean | "disable" | undefined,
): ChromeHideMode {
  return v === "disable" ? "disable" : v ? "hide" : "off";
}

export const ANIMATION_CUSTOM_MIN = 0;
export const ANIMATION_CUSTOM_MAX = 2.5;

export function clampAnimationCustom(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(ANIMATION_CUSTOM_MAX, Math.max(ANIMATION_CUSTOM_MIN, v));
}

export type LspActivation = "enabled" | "dismissed";

export type LspCustomServer = {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** languageResolver id -> LSP languageId */
  languages: Record<string, string>;
  rootMarkers: string[];
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
const KEY_CUSTOM_ENDPOINTS = "customEndpoints";
const KEY_OPENROUTER_MODEL_ID = "openrouterModelId";
const KEY_STT_PROVIDER = "sttProvider";
const KEY_GROQ_STT_MODEL = "groqSttModel";
const KEY_WHISPERCPP_BASE_URL = "whispercppBaseURL";
const KEY_FAVORITE_MODELS = "favoriteModelIds";
const KEY_RECENT_MODELS = "recentModelIds";
const KEY_VIM_MODE = "vimMode";
const KEY_VIM_KEYMAPS = "vimKeymaps";
const KEY_EDITOR_WORD_WRAP = "editorWordWrap";
const KEY_SIDEBAR_START_COLLAPSED = "sidebarStartCollapsed";
const KEY_STATUS_BAR_VISIBLE = "statusBarVisible";
const KEY_STATUS_BAR_START_COLLAPSED = "statusBarStartCollapsed";
const KEY_SIDEBAR_DISABLED = "sidebarDisabled";
const KEY_STATUS_BAR_DISABLED = "statusBarDisabled";
const KEY_HOVER_KEYBIND_HINTS = "hoverKeybindHints";
const KEY_ANIMATION_SPEED = "animationSpeed";
const KEY_ANIMATION_SPEED_CUSTOM = "animationSpeedCustom";
const KEY_SHOW_HIDDEN = "showHidden";
const LEGACY_KEY_SHOW_HIDDEN_DIRS = "showHiddenDirectories";
const KEY_EXPLORER_GIT_DECORATIONS = "explorerGitDecorations";
const KEY_TERMINAL_WEBGL_ENABLED = "terminalWebglEnabled";
const KEY_TERMINAL_CURSOR_BLINK = "terminalCursorBlink";
const KEY_TERMINAL_FONT_FAMILY = "terminalFontFamily";
const KEY_TERMINAL_FONT_WEIGHT = "terminalFontWeight";
const KEY_TERMINAL_SHELL = "terminalShell";
const KEY_TERMINAL_LETTER_SPACING = "terminalLetterSpacing";
const KEY_TERMINAL_FONT_SIZE = "terminalFontSize";
const KEY_TERMINAL_SCROLLBACK = "terminalScrollback";
const KEY_TERMINAL_PADDING = "terminalPadding";
const KEY_TERMINAL_PADDING_SIDES = "terminalPaddingSides";
const KEY_TERMINAL_SUGGEST_ENABLED = "terminalSuggestEnabled";
const KEY_TERMINAL_SUGGEST_DELAY = "terminalSuggestDelayMs";
const KEY_TERMINAL_SUGGEST_AI_DELAY = "terminalSuggestAiDelayMs";
const KEY_TERMINAL_SUGGEST_MAX_ITEMS = "terminalSuggestMaxItems";
const KEY_TERMINAL_SUGGEST_MIN_CHARS = "terminalSuggestMinChars";
const KEY_SMART_TAB_TITLES = "smartTabTitles";
const KEY_TAB_PROGRESS = "tabProgressEnabled";
const KEY_COMMAND_DONE_TOASTS = "commandDoneToasts";
const KEY_FAILED_COMMAND_AI = "failedCommandAi";
const KEY_NL_COMMANDS = "nlCommandsEnabled";
const KEY_SSH_PALETTE = "sshPaletteEnabled";
const KEY_LAST_WSL_DISTRO = "lastWslDistro";
const KEY_ZOOM_LEVEL = "zoomLevel";
const KEY_AGENT_NOTIFICATIONS = "agentNotifications";
const KEY_DEFAULT_WORKSPACE_ENV = "defaultWorkspaceEnv";
const KEY_SHORTCUTS = "shortcuts";
const KEY_EDITOR_AUTO_SAVE = "editorAutoSave";
const KEY_EDITOR_AUTO_SAVE_DELAY = "editorAutoSaveDelay";
const KEY_EDITOR_FORMAT_ON_SAVE = "editorFormatOnSave";
const KEY_LSP_ACTIVATION = "lspActivation";
const KEY_LSP_CUSTOM_SERVERS = "lspCustomServers";
const KEY_SHELL_TOOLS = "shellTools";

export const TERMINAL_FONT_SIZE_DEFAULT = 14;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const TERMINAL_FONT_SIZES = [
  10, 12, 13, 14, 15, 16, 18, 20, 22, 24,
] as const;

export const TERMINAL_FONT_WEIGHTS = [
  { value: "normal", label: "Normal" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semi-Bold" },
  { value: "bold", label: "Bold" },
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
  editorTheme: EDITOR_THEME_AUTO,
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
  customEndpoints: [],
  openrouterModelId: "",
  sttProvider: DEFAULT_STT_PROVIDER,
  groqSttModel: "whisper-large-v3-turbo",
  whispercppBaseURL: WHISPERCPP_DEFAULT_BASE_URL,
  favoriteModelIds: [],
  recentModelIds: [],
  vimMode: false,
  vimKeymaps: [],
  editorWordWrap: false,
  sidebarStartCollapsed: false,
  statusBarVisible: true,
  statusBarStartCollapsed: false,
  sidebarDisabled: false,
  statusBarDisabled: false,
  hoverKeybindHints: true,
  animationSpeed: "normal",
  animationSpeedCustom: 1,
  showHidden: false,
  explorerGitDecorations: true,
  terminalWebglEnabled: true,
  terminalCursorBlink: false,
  terminalFontFamily: "",
  terminalFontWeight: "normal",
  terminalShell: "",
  terminalLetterSpacing: 0,
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalScrollback: TERMINAL_SCROLLBACK_DEFAULT,
  // The preference is the sole source of the terminal gap (the tab surface
  // adds no inset of its own), so the default recreates the classic look.
  terminalPadding: 8,
  terminalPaddingSides: null,
  terminalSuggestEnabled: true,
  terminalSuggestDelayMs: 90,
  terminalSuggestAiDelayMs: 400,
  terminalSuggestMaxItems: 6,
  terminalSuggestMinChars: 3,
  smartTabTitles: true,
  tabProgressEnabled: true,
  commandDoneToasts: true,
  failedCommandAi: true,
  nlCommandsEnabled: true,
  sshPaletteEnabled: true,
  lastWslDistro: null,
  zoomLevel: 1.0,
  agentNotifications: true,
  defaultWorkspaceEnv: "local",
  shortcuts: {} as Record<ShortcutId, KeyBinding[]>,
  editorAutoSave: false,
  editorAutoSaveDelay: 1000,
  editorFormatOnSave: false,
  lspActivation: {},
  lspCustomServers: [],
  shellTools: [
    {
      id: "nvim",
      name: "Neovim",
      patterns: ["nvim", "vim", "vi"],
      blockShortcuts: true,
    },
  ],
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
    defaultModelId: ((): ModelId => {
      const stored = get<string>(KEY_DEFAULT_MODEL);
      return stored && isKnownModelId(stored)
        ? stored
        : DEFAULT_PREFERENCES.defaultModelId;
    })(),
    editorTheme: ((): EditorThemePref => {
      const stored = get<string>(KEY_EDITOR_THEME);
      if (stored === EDITOR_THEME_AUTO || isEditorThemeId(stored))
        return stored;
      return DEFAULT_PREFERENCES.editorTheme;
    })(),
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
    mlxBaseURL: get<string>(KEY_MLX_BASE_URL) ?? DEFAULT_PREFERENCES.mlxBaseURL,
    mlxModelId: get<string>(KEY_MLX_MODEL_ID) ?? DEFAULT_PREFERENCES.mlxModelId,
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
    customEndpoints: (() => {
      const stored = get<CustomEndpoint[]>(KEY_CUSTOM_ENDPOINTS);
      if (stored && stored.length > 0) return stored;
      return migrateLegacyCompatEndpoint(
        get<string>(KEY_OPENAI_COMPAT_BASE_URL) ?? "",
        get<string>(KEY_OPENAI_COMPAT_MODEL_ID) ?? "",
        get<number>(KEY_OPENAI_COMPAT_CONTEXT_LIMIT) ?? 128_000,
        crypto.randomUUID().slice(0, 8),
      );
    })(),
    openrouterModelId:
      get<string>(KEY_OPENROUTER_MODEL_ID) ??
      DEFAULT_PREFERENCES.openrouterModelId,
    sttProvider:
      get<SttProvider>(KEY_STT_PROVIDER) ?? DEFAULT_PREFERENCES.sttProvider,
    groqSttModel:
      get<string>(KEY_GROQ_STT_MODEL) ?? DEFAULT_PREFERENCES.groqSttModel,
    whispercppBaseURL:
      get<string>(KEY_WHISPERCPP_BASE_URL) ??
      DEFAULT_PREFERENCES.whispercppBaseURL,
    favoriteModelIds: (
      get<string[]>(KEY_FAVORITE_MODELS) ?? DEFAULT_PREFERENCES.favoriteModelIds
    ).filter(isKnownModelId),
    recentModelIds: (
      get<string[]>(KEY_RECENT_MODELS) ?? DEFAULT_PREFERENCES.recentModelIds
    ).filter(isKnownModelId),
    vimMode: get<boolean>(KEY_VIM_MODE) ?? DEFAULT_PREFERENCES.vimMode,
    vimKeymaps: ((): VimKeymap[] => {
      const stored = get<VimKeymap[]>(KEY_VIM_KEYMAPS);
      if (!Array.isArray(stored)) return DEFAULT_PREFERENCES.vimKeymaps;
      return stored.filter(
        (m): m is VimKeymap =>
          !!m &&
          typeof m.lhs === "string" &&
          typeof m.rhs === "string" &&
          (m.mode === "insert" || m.mode === "normal" || m.mode === "visual"),
      );
    })(),
    editorWordWrap:
      get<boolean>(KEY_EDITOR_WORD_WRAP) ?? DEFAULT_PREFERENCES.editorWordWrap,
    sidebarStartCollapsed:
      get<boolean>(KEY_SIDEBAR_START_COLLAPSED) ??
      DEFAULT_PREFERENCES.sidebarStartCollapsed,
    statusBarVisible:
      get<boolean>(KEY_STATUS_BAR_VISIBLE) ??
      DEFAULT_PREFERENCES.statusBarVisible,
    statusBarStartCollapsed:
      get<boolean>(KEY_STATUS_BAR_START_COLLAPSED) ??
      DEFAULT_PREFERENCES.statusBarStartCollapsed,
    sidebarDisabled:
      get<boolean>(KEY_SIDEBAR_DISABLED) ?? DEFAULT_PREFERENCES.sidebarDisabled,
    statusBarDisabled:
      get<boolean>(KEY_STATUS_BAR_DISABLED) ??
      DEFAULT_PREFERENCES.statusBarDisabled,
    hoverKeybindHints:
      get<boolean>(KEY_HOVER_KEYBIND_HINTS) ??
      DEFAULT_PREFERENCES.hoverKeybindHints,
    animationSpeed: ((): AnimationSpeed => {
      const stored = get<string>(KEY_ANIMATION_SPEED);
      return stored === "off" ||
        stored === "fast" ||
        stored === "normal" ||
        stored === "slow" ||
        stored === "custom"
        ? stored
        : DEFAULT_PREFERENCES.animationSpeed;
    })(),
    animationSpeedCustom: clampAnimationCustom(
      get<number>(KEY_ANIMATION_SPEED_CUSTOM) ??
        DEFAULT_PREFERENCES.animationSpeedCustom,
    ),
    showHidden:
      get<boolean>(KEY_SHOW_HIDDEN) ??
      get<boolean>(LEGACY_KEY_SHOW_HIDDEN_DIRS) ??
      DEFAULT_PREFERENCES.showHidden,
    explorerGitDecorations:
      get<boolean>(KEY_EXPLORER_GIT_DECORATIONS) ??
      DEFAULT_PREFERENCES.explorerGitDecorations,
    terminalWebglEnabled:
      get<boolean>(KEY_TERMINAL_WEBGL_ENABLED) ??
      DEFAULT_PREFERENCES.terminalWebglEnabled,
    terminalCursorBlink:
      get<boolean>(KEY_TERMINAL_CURSOR_BLINK) ??
      DEFAULT_PREFERENCES.terminalCursorBlink,
    terminalFontFamily:
      get<string>(KEY_TERMINAL_FONT_FAMILY) ??
      DEFAULT_PREFERENCES.terminalFontFamily,
    terminalFontWeight: coerceFontWeight(
      get<string>(KEY_TERMINAL_FONT_WEIGHT) ??
        DEFAULT_PREFERENCES.terminalFontWeight,
    ),
    terminalShell:
      get<string>(KEY_TERMINAL_SHELL) ?? DEFAULT_PREFERENCES.terminalShell,
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
    terminalPadding: clampTerminalPadding(
      get<number>(KEY_TERMINAL_PADDING) ?? DEFAULT_PREFERENCES.terminalPadding,
    ),
    terminalSuggestEnabled:
      get<boolean>(KEY_TERMINAL_SUGGEST_ENABLED) ??
      DEFAULT_PREFERENCES.terminalSuggestEnabled,
    terminalSuggestDelayMs: clampTerminalSuggestDelay(
      get<number>(KEY_TERMINAL_SUGGEST_DELAY) ??
        DEFAULT_PREFERENCES.terminalSuggestDelayMs,
    ),
    terminalSuggestAiDelayMs: clampTerminalSuggestAiDelay(
      get<number>(KEY_TERMINAL_SUGGEST_AI_DELAY) ??
        DEFAULT_PREFERENCES.terminalSuggestAiDelayMs,
    ),
    terminalSuggestMaxItems: clampTerminalSuggestMaxItems(
      get<number>(KEY_TERMINAL_SUGGEST_MAX_ITEMS) ??
        DEFAULT_PREFERENCES.terminalSuggestMaxItems,
    ),
    terminalSuggestMinChars: clampTerminalSuggestMinChars(
      get<number>(KEY_TERMINAL_SUGGEST_MIN_CHARS) ??
        DEFAULT_PREFERENCES.terminalSuggestMinChars,
    ),
    smartTabTitles:
      get<boolean>(KEY_SMART_TAB_TITLES) ?? DEFAULT_PREFERENCES.smartTabTitles,
    tabProgressEnabled:
      get<boolean>(KEY_TAB_PROGRESS) ??
      DEFAULT_PREFERENCES.tabProgressEnabled,
    commandDoneToasts:
      get<boolean>(KEY_COMMAND_DONE_TOASTS) ??
      DEFAULT_PREFERENCES.commandDoneToasts,
    failedCommandAi:
      get<boolean>(KEY_FAILED_COMMAND_AI) ??
      DEFAULT_PREFERENCES.failedCommandAi,
    nlCommandsEnabled:
      get<boolean>(KEY_NL_COMMANDS) ?? DEFAULT_PREFERENCES.nlCommandsEnabled,
    sshPaletteEnabled:
      get<boolean>(KEY_SSH_PALETTE) ?? DEFAULT_PREFERENCES.sshPaletteEnabled,
    terminalPaddingSides: ((): TerminalPaddingSides | null => {
      const stored = get<TerminalPaddingSides | null>(
        KEY_TERMINAL_PADDING_SIDES,
      );
      if (!stored || typeof stored !== "object") return null;
      return {
        top: clampTerminalPadding(stored.top ?? 0),
        right: clampTerminalPadding(stored.right ?? 0),
        bottom: clampTerminalPadding(stored.bottom ?? 0),
        left: clampTerminalPadding(stored.left ?? 0),
      };
    })(),
    lastWslDistro:
      get<string | null>(KEY_LAST_WSL_DISTRO) ??
      DEFAULT_PREFERENCES.lastWslDistro,
    zoomLevel: get<number>(KEY_ZOOM_LEVEL) ?? DEFAULT_PREFERENCES.zoomLevel,
    agentNotifications:
      get<boolean>(KEY_AGENT_NOTIFICATIONS) ??
      DEFAULT_PREFERENCES.agentNotifications,
    defaultWorkspaceEnv:
      get<string>(KEY_DEFAULT_WORKSPACE_ENV) ??
      DEFAULT_PREFERENCES.defaultWorkspaceEnv,
    shortcuts:
      get<Record<ShortcutId, KeyBinding[]>>(KEY_SHORTCUTS) ??
      DEFAULT_PREFERENCES.shortcuts,
    editorAutoSave:
      get<boolean>(KEY_EDITOR_AUTO_SAVE) ?? DEFAULT_PREFERENCES.editorAutoSave,
    editorAutoSaveDelay: clampAutoSaveDelay(
      get<number>(KEY_EDITOR_AUTO_SAVE_DELAY) ??
        DEFAULT_PREFERENCES.editorAutoSaveDelay,
    ),
    editorFormatOnSave:
      get<boolean>(KEY_EDITOR_FORMAT_ON_SAVE) ??
      DEFAULT_PREFERENCES.editorFormatOnSave,
    lspActivation:
      get<Record<string, LspActivation>>(KEY_LSP_ACTIVATION) ??
      DEFAULT_PREFERENCES.lspActivation,
    lspCustomServers:
      get<LspCustomServer[]>(KEY_LSP_CUSTOM_SERVERS) ??
      DEFAULT_PREFERENCES.lspCustomServers,
    shellTools:
      get<ShellTool[]>(KEY_SHELL_TOOLS) ?? DEFAULT_PREFERENCES.shellTools,
  };
}

export async function setLspActivation(
  id: string,
  value: LspActivation | null,
): Promise<void> {
  const current =
    ((await store.get(KEY_LSP_ACTIVATION)) as Record<string, LspActivation>) ??
    {};
  const next = { ...current };
  if (value === null) delete next[id];
  else next[id] = value;
  await writePref(KEY_LSP_ACTIVATION, next);
}

export async function setLspCustomServers(
  value: LspCustomServer[],
): Promise<void> {
  await writePref(KEY_LSP_CUSTOM_SERVERS, value);
}

export async function setShellTools(value: ShellTool[]): Promise<void> {
  await writePref(KEY_SHELL_TOOLS, value);
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

export async function setBackgroundImageId(
  value: string | null,
): Promise<void> {
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

export async function setEditorTheme(value: EditorThemePref): Promise<void> {
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

export async function setCustomEndpoints(
  value: CustomEndpoint[],
): Promise<void> {
  await writePref(KEY_CUSTOM_ENDPOINTS, value);
}

export async function setOpenrouterModelId(value: string): Promise<void> {
  await writePref(KEY_OPENROUTER_MODEL_ID, value);
}

export async function setSttProvider(value: SttProvider): Promise<void> {
  await writePref(KEY_STT_PROVIDER, value);
}

export async function setGroqSttModel(value: string): Promise<void> {
  await writePref(KEY_GROQ_STT_MODEL, value.trim());
}

export async function setWhispercppBaseURL(value: string): Promise<void> {
  await writePref(KEY_WHISPERCPP_BASE_URL, value.trim());
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

export type VimKeymap = {
  /** Keys to press, vim notation ("jj", "<C-e>"). */
  lhs: string;
  /** What they expand to ("<Esc>", "0", ":w<CR>"). */
  rhs: string;
  mode: "insert" | "normal" | "visual";
};

export async function setVimKeymaps(value: VimKeymap[]): Promise<void> {
  await writePref(KEY_VIM_KEYMAPS, value);
}

export async function setEditorWordWrap(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_WORD_WRAP, value);
}

export async function setSidebarStartCollapsed(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_START_COLLAPSED, value);
}

export async function setStatusBarVisible(value: boolean): Promise<void> {
  await writePref(KEY_STATUS_BAR_VISIBLE, value);
}

export async function setStatusBarStartCollapsed(
  value: boolean,
): Promise<void> {
  await writePref(KEY_STATUS_BAR_START_COLLAPSED, value);
}

export async function setSidebarDisabled(value: boolean): Promise<void> {
  await writePref(KEY_SIDEBAR_DISABLED, value);
}

export async function setStatusBarDisabled(value: boolean): Promise<void> {
  await writePref(KEY_STATUS_BAR_DISABLED, value);
}

export async function setHoverKeybindHints(value: boolean): Promise<void> {
  await writePref(KEY_HOVER_KEYBIND_HINTS, value);
}

export async function setAnimationSpeed(value: AnimationSpeed): Promise<void> {
  await writePref(KEY_ANIMATION_SPEED, value);
}

export async function setAnimationSpeedCustom(value: number): Promise<void> {
  await writePref(KEY_ANIMATION_SPEED_CUSTOM, clampAnimationCustom(value));
}

export async function setShowHidden(value: boolean): Promise<void> {
  await writePref(KEY_SHOW_HIDDEN, value);
}

export async function setExplorerGitDecorations(value: boolean): Promise<void> {
  await writePref(KEY_EXPLORER_GIT_DECORATIONS, value);
}

export async function setTerminalWebglEnabled(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_WEBGL_ENABLED, value);
}

export async function setTerminalCursorBlink(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_CURSOR_BLINK, value);
}

export async function setTerminalFontFamily(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_FAMILY, value.trim());
}

const TERMINAL_FONT_WEIGHT_VALUES = new Set(["normal", "500", "600", "bold"]);

export function coerceFontWeight(value: string): string {
  const v = value.trim();
  return TERMINAL_FONT_WEIGHT_VALUES.has(v) ? v : "normal";
}

export async function setTerminalFontWeight(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_FONT_WEIGHT, coerceFontWeight(value));
}

export async function setTerminalShell(value: string): Promise<void> {
  await writePref(KEY_TERMINAL_SHELL, value.trim());
}

export async function setTerminalLetterSpacing(value: number): Promise<void> {
  const clamped = Number.isFinite(value)
    ? Math.max(-10, Math.min(10, Math.round(value)))
    : 0;
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

// Negative padding crops the terminal's edges (e.g. to swallow a TUI's own
// gutter); symmetric with the positive range.
export const TERMINAL_PADDING_MIN = -32;
export const TERMINAL_PADDING_MAX = 32;

export function clampTerminalPadding(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // Fractional px are fine (1.9 etc.); keep one decimal to avoid float noise.
  const clamped = Math.min(
    TERMINAL_PADDING_MAX,
    Math.max(TERMINAL_PADDING_MIN, v),
  );
  return Math.round(clamped * 10) / 10;
}

export async function setTerminalPadding(value: number): Promise<void> {
  await writePref(KEY_TERMINAL_PADDING, clampTerminalPadding(value));
}

export type TerminalPaddingSides = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function clampTerminalPaddingSides(
  value: TerminalPaddingSides,
): TerminalPaddingSides {
  return {
    top: clampTerminalPadding(value.top),
    right: clampTerminalPadding(value.right),
    bottom: clampTerminalPadding(value.bottom),
    left: clampTerminalPadding(value.left),
  };
}

export const TERMINAL_SUGGEST_DELAY_MIN = 0;
export const TERMINAL_SUGGEST_DELAY_MAX = 1000;
export const TERMINAL_SUGGEST_AI_DELAY_MIN = 100;
export const TERMINAL_SUGGEST_AI_DELAY_MAX = 3000;
export const TERMINAL_SUGGEST_MAX_ITEMS_MIN = 1;
export const TERMINAL_SUGGEST_MAX_ITEMS_MAX = 10;
export const TERMINAL_SUGGEST_MIN_CHARS_MIN = 1;
export const TERMINAL_SUGGEST_MIN_CHARS_MAX = 10;

function clampInt(v: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

export function clampTerminalSuggestDelay(v: number): number {
  return clampInt(
    v,
    TERMINAL_SUGGEST_DELAY_MIN,
    TERMINAL_SUGGEST_DELAY_MAX,
    90,
  );
}

export function clampTerminalSuggestAiDelay(v: number): number {
  return clampInt(
    v,
    TERMINAL_SUGGEST_AI_DELAY_MIN,
    TERMINAL_SUGGEST_AI_DELAY_MAX,
    400,
  );
}

export function clampTerminalSuggestMaxItems(v: number): number {
  return clampInt(
    v,
    TERMINAL_SUGGEST_MAX_ITEMS_MIN,
    TERMINAL_SUGGEST_MAX_ITEMS_MAX,
    6,
  );
}

export async function setTerminalSuggestEnabled(value: boolean): Promise<void> {
  await writePref(KEY_TERMINAL_SUGGEST_ENABLED, value);
}

export async function setTerminalSuggestDelayMs(value: number): Promise<void> {
  await writePref(KEY_TERMINAL_SUGGEST_DELAY, clampTerminalSuggestDelay(value));
}

export async function setTerminalSuggestAiDelayMs(
  value: number,
): Promise<void> {
  await writePref(
    KEY_TERMINAL_SUGGEST_AI_DELAY,
    clampTerminalSuggestAiDelay(value),
  );
}

export function clampTerminalSuggestMinChars(v: number): number {
  return clampInt(
    v,
    TERMINAL_SUGGEST_MIN_CHARS_MIN,
    TERMINAL_SUGGEST_MIN_CHARS_MAX,
    3,
  );
}

export async function setTerminalSuggestMinChars(value: number): Promise<void> {
  await writePref(
    KEY_TERMINAL_SUGGEST_MIN_CHARS,
    clampTerminalSuggestMinChars(value),
  );
}

export async function setSmartTabTitles(value: boolean): Promise<void> {
  await writePref(KEY_SMART_TAB_TITLES, value);
}

export async function setTabProgressEnabled(value: boolean): Promise<void> {
  await writePref(KEY_TAB_PROGRESS, value);
}

export async function setCommandDoneToasts(value: boolean): Promise<void> {
  await writePref(KEY_COMMAND_DONE_TOASTS, value);
}

export async function setFailedCommandAi(value: boolean): Promise<void> {
  await writePref(KEY_FAILED_COMMAND_AI, value);
}

export async function setNlCommandsEnabled(value: boolean): Promise<void> {
  await writePref(KEY_NL_COMMANDS, value);
}

export async function setSshPaletteEnabled(value: boolean): Promise<void> {
  await writePref(KEY_SSH_PALETTE, value);
}

export async function setTerminalSuggestMaxItems(value: number): Promise<void> {
  await writePref(
    KEY_TERMINAL_SUGGEST_MAX_ITEMS,
    clampTerminalSuggestMaxItems(value),
  );
}

export async function setTerminalPaddingSides(
  value: TerminalPaddingSides | null,
): Promise<void> {
  await writePref(
    KEY_TERMINAL_PADDING_SIDES,
    value ? clampTerminalPaddingSides(value) : null,
  );
}

export async function setLastWslDistro(value: string | null): Promise<void> {
  await writePref(KEY_LAST_WSL_DISTRO, value);
}

export async function setZoomLevel(value: number): Promise<void> {
  await writePref(KEY_ZOOM_LEVEL, value);
}

function clampAutoSaveDelay(v: number): number {
  if (!Number.isFinite(v)) return 1000;
  return Math.min(60000, Math.max(100, Math.round(v)));
}

export async function setEditorAutoSave(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_AUTO_SAVE, value);
}

export async function setEditorAutoSaveDelay(value: number): Promise<void> {
  await writePref(KEY_EDITOR_AUTO_SAVE_DELAY, clampAutoSaveDelay(value));
}

export async function setEditorFormatOnSave(value: boolean): Promise<void> {
  await writePref(KEY_EDITOR_FORMAT_ON_SAVE, value);
}

export async function setAgentNotifications(value: boolean): Promise<void> {
  await writePref(KEY_AGENT_NOTIFICATIONS, value);
}

export async function setDefaultWorkspaceEnv(value: string): Promise<void> {
  await writePref(KEY_DEFAULT_WORKSPACE_ENV, value);
}

export async function setShortcuts(
  value: Record<ShortcutId, KeyBinding[]> | {},
): Promise<void> {
  await writePref(KEY_SHORTCUTS, value);
}

export async function resetShortcuts(): Promise<void> {
  await writePref(KEY_SHORTCUTS, DEFAULT_PREFERENCES.shortcuts);
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
    [KEY_CUSTOM_ENDPOINTS]: "customEndpoints",
    [KEY_OPENROUTER_MODEL_ID]: "openrouterModelId",
    [KEY_STT_PROVIDER]: "sttProvider",
    [KEY_GROQ_STT_MODEL]: "groqSttModel",
    [KEY_WHISPERCPP_BASE_URL]: "whispercppBaseURL",
    [KEY_FAVORITE_MODELS]: "favoriteModelIds",
    [KEY_RECENT_MODELS]: "recentModelIds",
    [KEY_VIM_MODE]: "vimMode",
    [KEY_VIM_KEYMAPS]: "vimKeymaps",
    [KEY_EDITOR_WORD_WRAP]: "editorWordWrap",
    [KEY_SIDEBAR_START_COLLAPSED]: "sidebarStartCollapsed",
    [KEY_STATUS_BAR_VISIBLE]: "statusBarVisible",
    [KEY_STATUS_BAR_START_COLLAPSED]: "statusBarStartCollapsed",
    [KEY_SIDEBAR_DISABLED]: "sidebarDisabled",
    [KEY_STATUS_BAR_DISABLED]: "statusBarDisabled",
    [KEY_HOVER_KEYBIND_HINTS]: "hoverKeybindHints",
    [KEY_ANIMATION_SPEED]: "animationSpeed",
    [KEY_ANIMATION_SPEED_CUSTOM]: "animationSpeedCustom",
    [KEY_SHOW_HIDDEN]: "showHidden",
    [KEY_EXPLORER_GIT_DECORATIONS]: "explorerGitDecorations",
    [KEY_TERMINAL_WEBGL_ENABLED]: "terminalWebglEnabled",
    [KEY_TERMINAL_CURSOR_BLINK]: "terminalCursorBlink",
    [KEY_TERMINAL_FONT_FAMILY]: "terminalFontFamily",
    [KEY_TERMINAL_FONT_WEIGHT]: "terminalFontWeight",
    [KEY_TERMINAL_SHELL]: "terminalShell",
    [KEY_TERMINAL_LETTER_SPACING]: "terminalLetterSpacing",
    [KEY_TERMINAL_FONT_SIZE]: "terminalFontSize",
    [KEY_TERMINAL_SCROLLBACK]: "terminalScrollback",
    [KEY_TERMINAL_PADDING]: "terminalPadding",
    [KEY_TERMINAL_SUGGEST_ENABLED]: "terminalSuggestEnabled",
    [KEY_TERMINAL_SUGGEST_DELAY]: "terminalSuggestDelayMs",
    [KEY_TERMINAL_SUGGEST_AI_DELAY]: "terminalSuggestAiDelayMs",
    [KEY_TERMINAL_SUGGEST_MAX_ITEMS]: "terminalSuggestMaxItems",
    [KEY_TERMINAL_SUGGEST_MIN_CHARS]: "terminalSuggestMinChars",
    [KEY_SMART_TAB_TITLES]: "smartTabTitles",
    [KEY_TAB_PROGRESS]: "tabProgressEnabled",
    [KEY_COMMAND_DONE_TOASTS]: "commandDoneToasts",
    [KEY_FAILED_COMMAND_AI]: "failedCommandAi",
    [KEY_NL_COMMANDS]: "nlCommandsEnabled",
    [KEY_SSH_PALETTE]: "sshPaletteEnabled",
    [KEY_TERMINAL_PADDING_SIDES]: "terminalPaddingSides",
    [KEY_LAST_WSL_DISTRO]: "lastWslDistro",
    [KEY_ZOOM_LEVEL]: "zoomLevel",
    [KEY_AGENT_NOTIFICATIONS]: "agentNotifications",
    [KEY_DEFAULT_WORKSPACE_ENV]: "defaultWorkspaceEnv",
    [KEY_SHORTCUTS]: "shortcuts",
    [KEY_EDITOR_AUTO_SAVE]: "editorAutoSave",
    [KEY_EDITOR_AUTO_SAVE_DELAY]: "editorAutoSaveDelay",
    [KEY_EDITOR_FORMAT_ON_SAVE]: "editorFormatOnSave",
    [KEY_LSP_ACTIVATION]: "lspActivation",
    [KEY_LSP_CUSTOM_SERVERS]: "lspCustomServers",
    [KEY_SHELL_TOOLS]: "shellTools",
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
