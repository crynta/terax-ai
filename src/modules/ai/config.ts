export const KEYRING_SERVICE = "terax-ai";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "cerebras"
  | "groq"
  | "deepseek"
  | "openrouter"
  | "openai-compatible"
  | "lmstudio";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  keyringAccount: string;
  keyPrefix: string | null;
  consoleUrl: string;
  /** Provider accepts (but does not require) an API key. */
  keyOptional?: boolean;
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
    id: "deepseek",
    label: "DeepSeek",
    keyringAccount: "deepseek-api-key",
    keyPrefix: "sk-",
    consoleUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyringAccount: "openrouter-api-key",
    keyPrefix: "sk-or-",
    consoleUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    keyringAccount: "openai-compatible-api-key",
    keyPrefix: null,
    consoleUrl: "https://platform.openai.com/docs/api-reference",
    keyOptional: true,
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    keyringAccount: "",
    keyPrefix: null,
    consoleUrl: "https://lmstudio.ai/docs/basics/server",
  },
] as const;

export function getProvider(id: ProviderId): ProviderInfo {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/** 1 (lowest) – 5 (highest). For `cost`, higher = cheaper. */
export type CapabilityScore = 1 | 2 | 3 | 4 | 5;

export type ModelCapabilities = {
  intelligence: CapabilityScore;
  speed: CapabilityScore;
  cost: CapabilityScore;
};

export type ModelTag = "vision" | "reasoning" | "tools" | "coding";

export type ModelInfo = {
  id: string;
  provider: ProviderId;
  label: string;
  /** One short word for the dropdown trigger. */
  hint: string;
  /** One-line marketing-style description shown under the label. */
  description: string;
  capabilities: ModelCapabilities;
  tags?: readonly ModelTag[];
};

export const MODELS = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  {
    id: "gpt-5.5",
    provider: "openai",
    label: "GPT-5.5",
    hint: "Flagship",
    description: "OpenAI's frontier model for the hardest reasoning and code.",
    capabilities: { intelligence: 5, speed: 3, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    label: "GPT-5.4 mini",
    hint: "Fast",
    description: "Snappy default — great quality at much lower cost.",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["vision", "tools"],
  },
  {
    id: "gpt-5.3-codex",
    provider: "openai",
    label: "GPT-5.3 Codex",
    hint: "Coding",
    description: "Tuned for code generation, refactors and tool use.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["tools", "coding"],
  },
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    label: "GPT-4.1 mini",
    hint: "Cheap",
    description: "Legacy, ultra-cheap workhorse for high-volume tasks.",
    capabilities: { intelligence: 3, speed: 4, cost: 5 },
    tags: ["vision", "tools"],
  },

  // ── Anthropic ─────────────────────────────────────────────────────────────
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    label: "Claude Opus 4.7",
    hint: "Best",
    description: "Anthropic's flagship — best for long, layered reasoning.",
    capabilities: { intelligence: 5, speed: 2, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    label: "Claude Sonnet 4.6",
    hint: "Balanced",
    description: "Sweet spot between Opus quality and Haiku speed.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    hint: "Fast",
    description: "Lightning-quick replies, gentle on the wallet.",
    capabilities: { intelligence: 3, speed: 5, cost: 4 },
    tags: ["vision", "tools"],
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    label: "Claude Opus 4.6",
    hint: "Legacy",
    description: "Previous-gen Opus — kept for prompt-stability.",
    capabilities: { intelligence: 5, speed: 2, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },

  // ── Google ────────────────────────────────────────────────────────────────
  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    label: "Gemini 3.1 Pro",
    hint: "Flagship",
    description: "Google's strongest reasoning + huge 1M context.",
    capabilities: { intelligence: 5, speed: 3, cost: 2 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    label: "Gemini 3 Flash",
    hint: "Fast",
    description: "Fast multimodal model, 1M context, cheap.",
    capabilities: { intelligence: 4, speed: 5, cost: 4 },
    tags: ["vision", "tools"],
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    label: "Gemini 2.5 Pro",
    hint: "Stable",
    description: "Production-stable Gemini for complex workloads.",
    capabilities: { intelligence: 4, speed: 3, cost: 3 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    label: "Gemini 2.5 Flash",
    hint: "Cheap",
    description: "Most efficient — bulk throughput at low cost.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["vision", "tools"],
  },

  // ── xAI ───────────────────────────────────────────────────────────────────
  {
    id: "grok-4.20-reasoning",
    provider: "xai",
    label: "Grok 4.20 Reasoning",
    hint: "Reasoning",
    description: "Frontier reasoning model with extended thinking.",
    capabilities: { intelligence: 5, speed: 2, cost: 2 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "grok-4.20-non-reasoning",
    provider: "xai",
    label: "Grok 4.20",
    hint: "Fast",
    description: "Non-reasoning fast tier for chat and tool use.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["tools"],
  },
  {
    id: "grok-3",
    provider: "xai",
    label: "Grok 3",
    hint: "Legacy",
    description: "Previous-gen Grok, kept for backwards compatibility.",
    capabilities: { intelligence: 3, speed: 4, cost: 4 },
    tags: ["tools"],
  },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    label: "DeepSeek V4 Pro",
    hint: "Best",
    description: "DeepSeek's strongest open-weight, exceptional at code.",
    capabilities: { intelligence: 5, speed: 3, cost: 4 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    label: "DeepSeek V4 Flash",
    hint: "Fast",
    description: "Fast tier for everyday tasks — very cheap.",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["tools"],
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    label: "DeepSeek Reasoner",
    hint: "Thinking",
    description: "Chain-of-thought reasoning at open-weight prices.",
    capabilities: { intelligence: 5, speed: 2, cost: 4 },
    tags: ["reasoning", "coding"],
  },

  // ── Cerebras (autocomplete-tier) ──────────────────────────────────────────
  {
    id: "gpt-oss-120b",
    provider: "cerebras",
    label: "GPT-OSS 120B",
    hint: "Ultra-fast",
    description: "Cerebras silicon — fastest inference available today.",
    capabilities: { intelligence: 4, speed: 5, cost: 4 },
    tags: ["tools", "coding"],
  },
  {
    id: "llama3.3-70b",
    provider: "cerebras",
    label: "Llama 3.3 70B",
    hint: "Fast",
    description: "Open-weight Meta model on Cerebras wafer-scale.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["tools"],
  },
  {
    id: "qwen-3-32b",
    provider: "cerebras",
    label: "Qwen 3 32B",
    hint: "Fast",
    description: "Capable multilingual model at extreme speed.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["tools", "coding"],
  },

  // ── Groq (autocomplete-tier) ──────────────────────────────────────────────
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT-OSS 20B",
    hint: "Ultra-fast",
    description: "Groq LPU inference — sub-second responses.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["tools", "coding"],
  },
  {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    label: "Llama 3.3 70B",
    hint: "Versatile",
    description: "Meta's flagship open model — fast and broadly capable.",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["tools"],
  },
  {
    id: "deepseek-r1-distill-llama-70b",
    provider: "groq",
    label: "DeepSeek R1 Distill 70B",
    hint: "Thinking",
    description: "Reasoning-distilled Llama, fast and thoughtful.",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["reasoning", "tools"],
  },

  // ── OpenRouter (gateway — curated cross-provider routes) ──────────────────
  {
    id: "anthropic/claude-opus-4-7",
    provider: "openrouter",
    label: "Claude Opus 4.7",
    hint: "via OpenRouter",
    description: "Anthropic's flagship routed through OpenRouter.",
    capabilities: { intelligence: 5, speed: 2, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    provider: "openrouter",
    label: "Claude Sonnet 4.6",
    hint: "via OpenRouter",
    description: "Balanced Claude routed through OpenRouter.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "openai/gpt-5.5",
    provider: "openrouter",
    label: "GPT-5.5",
    hint: "via OpenRouter",
    description: "OpenAI's flagship routed through OpenRouter.",
    capabilities: { intelligence: 5, speed: 3, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "google/gemini-3.1-pro-preview",
    provider: "openrouter",
    label: "Gemini 3.1 Pro",
    hint: "via OpenRouter",
    description: "Google's strongest model via OpenRouter.",
    capabilities: { intelligence: 5, speed: 3, cost: 2 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "x-ai/grok-4.20-reasoning",
    provider: "openrouter",
    label: "Grok 4.20 Reasoning",
    hint: "via OpenRouter",
    description: "xAI's reasoning model via OpenRouter.",
    capabilities: { intelligence: 5, speed: 2, cost: 2 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    label: "DeepSeek V4 Pro",
    hint: "via OpenRouter",
    description: "Strong open-weight coding model via OpenRouter.",
    capabilities: { intelligence: 5, speed: 3, cost: 5 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    provider: "openrouter",
    label: "Llama 4 Scout",
    hint: "via OpenRouter",
    description: "Meta's latest open model — efficient and multimodal.",
    capabilities: { intelligence: 4, speed: 4, cost: 5 },
    tags: ["vision", "tools"],
  },
  {
    id: "moonshotai/kimi-k2.5",
    provider: "openrouter",
    label: "Kimi K2.5",
    hint: "via OpenRouter",
    description: "Moonshot's flagship — strong agentic & coding skills.",
    capabilities: { intelligence: 5, speed: 3, cost: 4 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "qwen/qwen3-max",
    provider: "openrouter",
    label: "Qwen 3 Max",
    hint: "via OpenRouter",
    description: "Alibaba's flagship multilingual reasoner.",
    capabilities: { intelligence: 5, speed: 3, cost: 4 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "mistralai/mistral-large-latest",
    provider: "openrouter",
    label: "Mistral Large",
    hint: "via OpenRouter",
    description: "Mistral's EU-hosted flagship for general tasks.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["tools", "coding"],
  },
  {
    id: "z-ai/glm-4.6",
    provider: "openrouter",
    label: "GLM 4.6",
    hint: "via OpenRouter",
    description: "Zhipu's GLM — strong agentic & long-context model.",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["tools", "coding"],
  },

  // ── Generic OpenAI-compatible (user-defined endpoint) ─────────────────────
  {
    id: "openai-compatible-custom",
    provider: "openai-compatible",
    label: "Custom endpoint",
    hint: "Configurable",
    description: "Any OpenAI-compatible HTTPS endpoint (vLLM, Z.AI, …).",
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  },

  // ── LM Studio (local; model id is user-supplied at runtime) ───────────────
  {
    id: "lmstudio-local",
    provider: "lmstudio",
    label: "LM Studio",
    hint: "Local",
    description: "Run any GGUF model locally via LM Studio's HTTP server.",
    capabilities: { intelligence: 3, speed: 3, cost: 5 },
  },
] as const satisfies readonly ModelInfo[];

export type ModelId = (typeof MODELS)[number]["id"];

export function getModel(id: ModelId): ModelInfo {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}

export const DEFAULT_MODEL_ID: ModelId = "gpt-5.4-mini";

/** Approximate context window (in tokens) per model. Used for the
 *  context-usage indicator in the AI mini-window header. Conservative
 *  estimates — actual provider limits may shift. */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "gpt-5.5": 1_050_000,
  "gpt-5.4-mini": 400_000,
  "gpt-5.3-codex": 400_000,
  "gpt-4.1-mini": 128_000,
  "claude-opus-4-7": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5": 200_000,
  "claude-opus-4-6": 200_000,
  "gemini-3.1-pro-preview": 1_000_000,
  "gemini-3-flash-preview": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
  "grok-4.20-reasoning": 2_000_000,
  "grok-4.20-non-reasoning": 2_000_000,
  "grok-3": 128_000,
  "deepseek-v4-pro": 1_000_000,
  "deepseek-v4-flash": 1_000_000,
  "deepseek-reasoner": 128_000,
  "gpt-oss-120b": 128_000,
  "llama3.3-70b": 128_000,
  "qwen-3-32b": 32_000,
  "openai/gpt-oss-20b": 128_000,
  "llama-3.3-70b-versatile": 128_000,
  "deepseek-r1-distill-llama-70b": 128_000,
  "anthropic/claude-opus-4-7": 200_000,
  "anthropic/claude-sonnet-4-6": 200_000,
  "openai/gpt-5.5": 1_050_000,
  "google/gemini-3.1-pro-preview": 1_000_000,
  "x-ai/grok-4.20-reasoning": 2_000_000,
  "deepseek/deepseek-v4-pro": 1_000_000,
  "meta-llama/llama-4-scout-17b-16e-instruct": 128_000,
  "moonshotai/kimi-k2.5": 256_000,
  "qwen/qwen3-max": 256_000,
  "mistralai/mistral-large-latest": 128_000,
  "z-ai/glm-4.6": 128_000,
  "openai-compatible-custom": 128_000,
  "lmstudio-local": 32_000,
};

export function getModelContextLimit(modelId: string | undefined): number {
  if (!modelId) return 128_000;
  return MODEL_CONTEXT_LIMITS[modelId] ?? 128_000;
}

/** Providers that do not require an API key (local servers, key-optional). */
export const KEYLESS_PROVIDERS: readonly ProviderId[] = [
  "lmstudio",
  "openai-compatible",
] as const;

export function providerNeedsKey(id: ProviderId): boolean {
  return !KEYLESS_PROVIDERS.includes(id);
}

/** True for providers that accept an API key — required *or* optional.
 *  Used by Settings to decide whether to render a key card at all. */
export function providerSupportsKey(id: ProviderId): boolean {
  if (providerNeedsKey(id)) return true;
  const p = getProvider(id);
  return !!p.keyOptional;
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
export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "";
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
