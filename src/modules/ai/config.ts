export const KEYRING_SERVICE = "terax-ai";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "cerebras"
  | "groq"
  | "lmstudio"
  | "github-copilot";

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
  {
    id: "cerebras",
    label: "Cerebras",
    keyringAccount: "cerebras-api-key",
    keyPrefix: "csk-",
    consoleUrl: "https://cloud.cerebras.ai/",
  },
  {
    id: "groq",
    label: "Groq",
    keyringAccount: "groq-api-key",
    keyPrefix: "gsk_",
    consoleUrl: "https://console.groq.com/keys",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    keyringAccount: "",
    keyPrefix: null,
    consoleUrl: "https://lmstudio.ai/docs/basics/server",
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    keyringAccount: "copilot-gho-token",
    keyPrefix: "gho_",
    consoleUrl: "https://github.com/settings/tokens",
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
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    label: "GPT-5.4 mini",
    hint: "Fast, default",
  },
  {
    id: "gpt-5.5",
    provider: "openai",
    label: "GPT-5.5",
    hint: "Higher quality",
  },
  {
    id: "gpt-5.3-codex",
    provider: "openai",
    label: "GPT-5.3 Codex",
    hint: "Coding",
  },
  // Anthropic
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    hint: "Fast",
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    label: "Claude Sonnet 4.6",
    hint: "Balanced",
  },
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    label: "Claude Opus 4.7",
    hint: "Best",
  },
  // Google
  {
    id: "gemini-3.1-pro",
    provider: "google",
    label: "Gemini 3.1 Pro",
    hint: "Best",
  },
  {
    id: "gemini-3-flash",
    provider: "google",
    label: "Gemini 3 Flash",
    hint: "Fast",
  },
  // xAI
  {
    id: "grok-4.20-reasoning",
    provider: "xai",
    label: "Grok 4.20 Reasoning",
    hint: "Reasoning",
  },
  {
    id: "grok-4.20-non-reasoning",
    provider: "xai",
    label: "Grok 4.20",
    hint: "Fast",
  },
  // Cerebras (autocomplete-tier)
  {
    id: "gpt-oss-120b",
    provider: "cerebras",
    label: "GPT-OSS 120B",
    hint: "Cerebras · ultra-fast",
  },
  // Groq (autocomplete-tier)
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT-OSS 20B",
    hint: "Groq · ultra-fast",
  },
  // LM Studio (local; model id is user-supplied at runtime)
  {
    id: "lmstudio-local",
    provider: "lmstudio",
    label: "LM Studio (local)",
    hint: "Custom local model",
  },
] as const satisfies readonly ModelInfo[];

export type ModelId = (typeof MODELS)[number]["id"] | (string & {});

export function getModel(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (m) return m;
  // Fallback for dynamic models (e.g. GitHub Copilot models fetched at runtime).
  return { id, provider: "github-copilot", label: id, hint: "" };
}

export const DEFAULT_MODEL_ID: ModelId = "gpt-5.4-mini";

/** Approximate context window (in tokens) per model. Used for the
 *  context-usage indicator in the AI mini-window header. Conservative
 *  estimates — actual provider limits may shift. */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-5.4-mini": 400_000,
  "gpt-5.5": 1_050_000,
  "gpt-5.3-codex": 400_000,
  "claude-haiku-4-5": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4-7": 200_000,
  "gemini-3.1-pro": 1_000_000,
  "gemini-3-flash": 1_000_000,
  "grok-4.20-reasoning": 2_000_000,
  "grok-4.20-non-reasoning": 2_000_000,
  "gpt-oss-120b": 128_000,
  "openai/gpt-oss-20b": 128_000,
  "lmstudio-local": 32_000,
};

export function getModelContextLimit(modelId: string | undefined): number {
  if (!modelId) return 128_000;
  return MODEL_CONTEXT_LIMITS[modelId] ?? 128_000;
}

/** Providers that do not require an API key (e.g. local servers). */
export const KEYLESS_PROVIDERS: readonly ProviderId[] = ["lmstudio", "github-copilot"] as const;

export function providerNeedsKey(id: ProviderId): boolean {
  return !KEYLESS_PROVIDERS.includes(id);
}

/** Providers eligible for the editor's inline autocomplete (latency-critical). */
export type AutocompleteProviderId = "cerebras" | "groq" | "lmstudio";

export const AUTOCOMPLETE_PROVIDERS: readonly AutocompleteProviderId[] = [
  "cerebras",
  "groq",
  "lmstudio",
] as const;

export const DEFAULT_AUTOCOMPLETE_MODEL: Record<
  AutocompleteProviderId,
  string
> = {
  cerebras: "gpt-oss-120b",
  groq: "openai/gpt-oss-20b",
  lmstudio: "qwen2.5-coder-7b-instruct",
};

export const LMSTUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1";
export const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
export const COPILOT_AUTH_SCOPES = "read:user";
export const COPILOT_BASE_URL = "https://api.githubcopilot.com";
export const MAX_AGENT_STEPS = 24;
export const TERMINAL_BUFFER_LINES = 300;

export const SYSTEM_PROMPT = `You are Terax, an AI assistant embedded in a developer terminal emulator.

Every turn includes a <terminal-context> block with: workspace_root, active_terminal_cwd, optionally active_file, and the last lines of the user's terminal. Treat this as ground truth — do not ask the user where they are.

Tools:
- Read: read_file, list_directory, grep, glob
- Mutate (require approval): edit, multi_edit, write_file, create_directory, bash_run, bash_background
- Background read: bash_logs, bash_list, bash_kill
- Plan/state: todo_write
- Delegation: run_subagent (read-only worker for self-contained investigations)
- Other: suggest_command, open_preview

PLANNING:
- For any task with ≥3 substantive steps (multi-file refactors, feature work, debugging that requires investigation across files), call \`todo_write\` to commit to a plan BEFORE doing the work. Pass the full list each time you update it.
- Mark exactly one todo \`in_progress\` while working on it; flip it to \`completed\` and the next to \`in_progress\` immediately. Don't batch updates.
- Skip todo_write for trivial single-step asks (one read, one shell command, one small edit).

CODE NAVIGATION:
- Use grep for "where is X used / defined / referenced". Pass a regex; narrow scope with the optional \`glob\` filter (e.g. ['**/*.ts', '!**/node_modules/**']) and \`max_results\`.
- Use glob to enumerate files by path pattern (e.g. \`src/**/*.tsx\`).
- Do NOT brute-force read_file across the tree to find code — grep is faster, gitignore-aware, and won't blow context.

EDITING:
- Default to \`edit\` (single exact-string replace) and \`multi_edit\` (atomic batch on one file). Both require you to have called read_file on the path earlier this session — read first, edit second.
- \`old_string\` must be unique in the file unless \`replace_all: true\`. If a match isn't unique, expand the surrounding context until it is.
- Use \`write_file\` only for brand-new files or fully replacing tiny files. Never use it as a proxy for a small targeted change.

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
- Use bash_run when YOU need to execute something to complete the task (lint, test, search, install). cwd persists across calls in your session shell. NEVER invoke interactive tools (vim, less, top, watch) — they will hang. NEVER run dev servers / watchers via bash_run — they will block until timeout, then orphan the process; use bash_background.
- For long-running processes (dev servers, watchers, log tailers), use bash_background → poll output via bash_logs → bash_kill when done. After a dev server is up, call open_preview with its local URL so the rendered page shows in a tab.

DEV SERVERS — AVOID DUPLICATES:
- BEFORE calling bash_background for a dev server (\`pnpm dev\`, \`pnpm run dev\`, \`next dev\`, \`vite\`, \`npm run dev\`, \`yarn dev\`, \`bun dev\`, \`cargo watch\`, etc.), call \`bash_list\` first.
- If an entry exists with a matching command and \`exited: false\`, DO NOT respawn it. Re-use the existing process: call open_preview with the URL you previously surfaced (or the conventional one — Next.js: 3000, Vite: 5173). Tell the user "already running on port X".
- Only spawn a new dev server if none is running, or the user explicitly asked you to restart it (in which case call bash_kill on the old handle first, then bash_background).
- Same rule for editing files in a project that already has a dev server running: edit, then just tell the user "the dev server should hot-reload" — don't respawn.
- Otherwise, respond as Markdown prose. Code blocks always carry a language fence.

APPROVAL:
- edit, multi_edit, write_file, create_directory, bash_run, bash_background require user approval. State *why* in one sentence before the call.
- If a read tool returns "Refused" for a sensitive file (.env, .ssh, credentials), do not retry — tell the user it is blocked.

STYLE:
- Concise. No filler, no apologies, no restating the question. The surface is small.`;
