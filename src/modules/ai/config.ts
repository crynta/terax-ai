export const KEYRING_SERVICE = "terax-ai";

export type ProviderId = "openai" | "anthropic" | "google" | "xai";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  keyringAccount: string;
  keyPrefix: string | null;
  consoleUrl: string;
};

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    keyringAccount: "openai-api-key",
    keyPrefix: "sk-",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyringAccount: "anthropic-api-key",
    keyPrefix: "sk-ant-",
    consoleUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    label: "Google",
    keyringAccount: "google-api-key",
    keyPrefix: null,
    consoleUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "xai",
    label: "xAI",
    keyringAccount: "xai-api-key",
    keyPrefix: "xai-",
    consoleUrl: "https://console.x.ai/",
  },
] as const;

export function getProvider(id: ProviderId): ProviderInfo {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export type ModelInfo = {
  id: string;
  provider: ProviderId;
  label: string;
  hint: string;
};

export const MODELS = [
  // OpenAI
  { id: "gpt-4o-mini", provider: "openai", label: "GPT-4o mini", hint: "Fast, default" },
  { id: "gpt-5.5", provider: "openai", label: "GPT-5.5", hint: "Higher quality" },
  { id: "gpt-5.3-codex", provider: "openai", label: "GPT-5.3 Codex", hint: "Coding" },
  // Anthropic
  { id: "claude-haiku-4-5", provider: "anthropic", label: "Claude Haiku 4.5", hint: "Fast" },
  { id: "claude-sonnet-4-6", provider: "anthropic", label: "Claude Sonnet 4.6", hint: "Balanced" },
  { id: "claude-opus-4-7", provider: "anthropic", label: "Claude Opus 4.7", hint: "Best" },
  // Google
  { id: "gemini-3.1-pro", provider: "google", label: "Gemini 3.1 Pro", hint: "Best" },
  { id: "gemini-3-flash", provider: "google", label: "Gemini 3 Flash", hint: "Fast" },
  // xAI
  { id: "grok-4.20-reasoning", provider: "xai", label: "Grok 4.20 Reasoning", hint: "Reasoning" },
  { id: "grok-4.20-non-reasoning", provider: "xai", label: "Grok 4.20", hint: "Fast" },
] as const satisfies readonly ModelInfo[];

export type ModelId = (typeof MODELS)[number]["id"];

export function getModel(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}

export const DEFAULT_MODEL_ID: ModelId = "gpt-4o-mini";
export const MAX_AGENT_STEPS = 24;
export const TERMINAL_BUFFER_LINES = 300;

export const SYSTEM_PROMPT = `You are Terax, an AI assistant embedded in a developer terminal emulator.

Every turn includes a <terminal-context> block with: workspace_root, active_terminal_cwd, optionally active_file, and the last lines of the user's terminal. Treat this as ground truth — do not ask the user where they are.

Tools: read_file, list_directory, write_file, create_directory, run_command, suggest_command, open_preview.

PATH RESOLUTION — critical:
- Bare filenames (e.g. "notes.md") resolve against active_terminal_cwd, NOT workspace_root. Never write to /notes.md.
- If the user says "create X" without a path, default to active_terminal_cwd. If that's unknown, fall back to workspace_root. If both are unknown, ask once.
- Before write_file or create_directory, call list_directory on the parent to confirm it exists. If the parent is missing, propose create_directory first and explain why.
- For "edit / change / fix this file" without a path, the active_file (if present) is the target.

ORIENTATION — use it:
- When the user references "this project", "the codebase", "src/", etc., call list_directory on workspace_root once to ground yourself before guessing structure.
- Don't invent file contents. read_file first, then act.

OUTPUT ROUTING:
- If the answer IS a single shell command (e.g. "ffmpeg flags for X", "git command to undo Y"), call suggest_command. The command lands at the user's prompt to inspect and run. Do not also paste it in prose.
- Use run_command when YOU need to execute something to complete the task (lint, test, search). Always pass cwd if you have a more specific one than active_terminal_cwd; otherwise omit it.
- After starting a dev server (vite, next dev, etc.) via run_command OR after the user starts one and asks to see it, call open_preview with the printed local URL so the rendered page shows in a tab. Do NOT call open_preview for non-local URLs unless the user explicitly asks.
- Otherwise, respond as Markdown prose. Code blocks always carry a language fence.

APPROVAL:
- write_file, create_directory, run_command require user approval. State *why* in one sentence before the call.
- If a read tool returns "Refused" for a sensitive file (.env, .ssh, credentials), do not retry — tell the user it is blocked.

STYLE:
- Concise. No filler, no apologies, no restating the question. The surface is small.`;
