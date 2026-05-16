export const KEYRING_SERVICE = "terax-ai";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "cerebras"
  | "groq"
  | "deepseek"
  | "minimax"
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
    id: "minimax",
    label: "MiniMax",
    keyringAccount: "minimax-api-key",
    keyPrefix: null,
    consoleUrl: "https://platform.minimax.io/",
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
    description: "Frontier reasoning and code.",
    capabilities: { intelligence: 5, speed: 3, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    label: "GPT-5.4 mini",
    hint: "Fast",
    description: "Snappy default at low cost.",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["vision", "tools"],
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    label: "GPT-5.4 nano",
    hint: "Fastest",
    description: "Tiny and instant — great for autocomplete.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["tools"],
  },
  {
    id: "gpt-5.3-codex",
    provider: "openai",
    label: "GPT-5.3 Codex",
    hint: "Coding",
    description: "Tuned for code and tool use.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["tools", "coding"],
  },
  {
    id: "gpt-4.1-mini",
    provider: "openai",
    label: "GPT-4.1 mini",
    hint: "Cheap",
    description: "Ultra-cheap workhorse for bulk tasks.",
    capabilities: { intelligence: 3, speed: 4, cost: 5 },
    tags: ["vision", "tools"],
  },

  // ── Anthropic ─────────────────────────────────────────────────────────────
  {
    id: "claude-opus-4-7",
    provider: "anthropic",
    label: "Claude Opus 4.7",
    hint: "Best",
    description: "Anthropic's flagship for long reasoning.",
    capabilities: { intelligence: 5, speed: 2, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    label: "Claude Sonnet 4.6",
    hint: "Balanced",
    description: "Sweet spot of quality and speed.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    hint: "Fast",
    description: "Quick, cheap, multimodal.",
    capabilities: { intelligence: 3, speed: 5, cost: 4 },
    tags: ["vision", "tools"],
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    label: "Claude Opus 4.6",
    hint: "Legacy",
    description: "Previous-gen Opus.",
    capabilities: { intelligence: 5, speed: 2, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },

  // ── Google ────────────────────────────────────────────────────────────────
  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    label: "Gemini 3.1 Pro",
    hint: "Flagship",
    description: "Strong reasoning, 1M context.",
    capabilities: { intelligence: 5, speed: 3, cost: 2 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "gemini-3-flash-preview",
    provider: "google",
    label: "Gemini 3 Flash",
    hint: "Fast",
    description: "Fast multimodal, 1M context.",
    capabilities: { intelligence: 4, speed: 5, cost: 4 },
    tags: ["vision", "tools"],
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    label: "Gemini 2.5 Pro",
    hint: "Stable",
    description: "Production-stable Gemini.",
    capabilities: { intelligence: 4, speed: 3, cost: 3 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    label: "Gemini 2.5 Flash",
    hint: "Cheap",
    description: "Bulk throughput at low cost.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["vision", "tools"],
  },

  // ── xAI ───────────────────────────────────────────────────────────────────
  {
    id: "grok-4.20-reasoning",
    provider: "xai",
    label: "Grok 4.20 Reasoning",
    hint: "Reasoning",
    description: "Frontier reasoning with extended thinking.",
    capabilities: { intelligence: 5, speed: 2, cost: 2 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "grok-4.20-non-reasoning",
    provider: "xai",
    label: "Grok 4.20",
    hint: "Fast",
    description: "Fast tier for chat and tools.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["tools"],
  },
  {
    id: "grok-4-fast-reasoning",
    provider: "xai",
    label: "Grok 4 Fast",
    hint: "Reasoning",
    description: "Cheaper Grok 4 with vision and reasoning.",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["vision", "reasoning", "tools"],
  },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    label: "DeepSeek V4 Pro",
    hint: "Best",
    description: "Strong open-weight code model.",
    capabilities: { intelligence: 5, speed: 3, cost: 4 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    label: "DeepSeek V4 Flash",
    hint: "Fast",
    description: "Cheap and fast everyday tier.",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["tools"],
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    label: "DeepSeek Reasoner",
    hint: "Thinking",
    description: "Chain-of-thought at open-weight prices.",
    capabilities: { intelligence: 5, speed: 2, cost: 4 },
    tags: ["reasoning", "coding"],
  },

  // ── MiniMax ──────────────────────────────────────────────────────────────
  {
    id: "MiniMax-M2.7",
    provider: "minimax",
    label: "MiniMax M2.7",
    hint: "Best",
    description: "Peak performance. Master the complex.",
    capabilities: { intelligence: 5, speed: 3, cost: 5 },
    tags: ["tools", "coding"],
  },
  {
    id: "MiniMax-M2.7-highspeed",
    provider: "minimax",
    label: "MiniMax M2.7 Highspeed",
    hint: "Fast",
    description: "Same performance, faster and more agile.",
    capabilities: { intelligence: 5, speed: 4, cost: 4 },
    tags: ["tools", "coding"],
  },

  // ── Cerebras (autocomplete-tier) ──────────────────────────────────────────
  {
    id: "gpt-oss-120b",
    provider: "cerebras",
    label: "GPT-OSS 120B",
    hint: "Ultra-fast",
    description: "Fastest inference on Cerebras silicon.",
    capabilities: { intelligence: 4, speed: 5, cost: 4 },
    tags: ["tools", "coding"],
  },
  {
    id: "llama3.3-70b",
    provider: "cerebras",
    label: "Llama 3.3 70B",
    hint: "Fast",
    description: "Meta's open model on wafer-scale silicon.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["tools"],
  },
  {
    id: "qwen-3-32b",
    provider: "cerebras",
    label: "Qwen 3 32B",
    hint: "Fast",
    description: "Multilingual model at extreme speed.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["tools", "coding"],
  },

  // ── Groq (autocomplete-tier) ──────────────────────────────────────────────
  {
    id: "openai/gpt-oss-20b",
    provider: "groq",
    label: "GPT-OSS 20B",
    hint: "Ultra-fast",
    description: "Sub-second responses on Groq LPU.",
    capabilities: { intelligence: 3, speed: 5, cost: 5 },
    tags: ["tools", "coding"],
  },
  {
    id: "llama-3.3-70b-versatile",
    provider: "groq",
    label: "Llama 3.3 70B",
    hint: "Versatile",
    description: "Fast and broadly capable.",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["tools"],
  },
  {
    id: "deepseek-r1-distill-llama-70b",
    provider: "groq",
    label: "DeepSeek R1 Distill 70B",
    hint: "Thinking",
    description: "Reasoning-distilled Llama on Groq.",
    capabilities: { intelligence: 4, speed: 5, cost: 5 },
    tags: ["reasoning", "tools"],
  },

  // ── OpenRouter (gateway — curated cross-provider routes) ──────────────────
  {
    id: "anthropic/claude-opus-4-7",
    provider: "openrouter",
    label: "Claude Opus 4.7",
    hint: "OpenRouter",
    description: "Anthropic flagship via OpenRouter.",
    capabilities: { intelligence: 5, speed: 2, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    provider: "openrouter",
    label: "Claude Sonnet 4.6",
    hint: "OpenRouter",
    description: "Balanced Claude via OpenRouter.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "openai/gpt-5.5",
    provider: "openrouter",
    label: "GPT-5.5",
    hint: "OpenRouter",
    description: "OpenAI flagship via OpenRouter.",
    capabilities: { intelligence: 5, speed: 3, cost: 1 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "openai/gpt-5.4-mini",
    provider: "openrouter",
    label: "GPT-5.4 mini",
    hint: "OpenRouter",
    description: "Snappy GPT via OpenRouter.",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["vision", "tools"],
  },
  {
    id: "google/gemini-3.1-pro-preview",
    provider: "openrouter",
    label: "Gemini 3.1 Pro",
    hint: "OpenRouter",
    description: "Google flagship via OpenRouter.",
    capabilities: { intelligence: 5, speed: 3, cost: 2 },
    tags: ["vision", "reasoning", "tools", "coding"],
  },
  {
    id: "x-ai/grok-4.20-reasoning",
    provider: "openrouter",
    label: "Grok 4.20 Reasoning",
    hint: "OpenRouter",
    description: "xAI reasoning via OpenRouter.",
    capabilities: { intelligence: 5, speed: 2, cost: 2 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    label: "DeepSeek V4 Pro",
    hint: "OpenRouter",
    description: "Open-weight coding model.",
    capabilities: { intelligence: 5, speed: 3, cost: 5 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "deepseek/deepseek-reasoner",
    provider: "openrouter",
    label: "DeepSeek Reasoner",
    hint: "OpenRouter",
    description: "Cheap chain-of-thought reasoner.",
    capabilities: { intelligence: 5, speed: 2, cost: 5 },
    tags: ["reasoning", "coding"],
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    provider: "openrouter",
    label: "Llama 4 Scout",
    hint: "OpenRouter",
    description: "Meta's efficient multimodal model.",
    capabilities: { intelligence: 4, speed: 4, cost: 5 },
    tags: ["vision", "tools"],
  },
  {
    id: "meta-llama/llama-4-maverick",
    provider: "openrouter",
    label: "Llama 4 Maverick",
    hint: "OpenRouter",
    description: "Meta's flagship open multimodal model.",
    capabilities: { intelligence: 4, speed: 3, cost: 5 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "moonshotai/kimi-k2.5",
    provider: "openrouter",
    label: "Kimi K2.5",
    hint: "OpenRouter",
    description: "Moonshot's agentic flagship.",
    capabilities: { intelligence: 5, speed: 3, cost: 4 },
    tags: ["vision", "tools", "coding"],
  },
  {
    id: "qwen/qwen3-max",
    provider: "openrouter",
    label: "Qwen 3 Max",
    hint: "OpenRouter",
    description: "Alibaba's multilingual reasoner.",
    capabilities: { intelligence: 5, speed: 3, cost: 4 },
    tags: ["reasoning", "tools", "coding"],
  },
  {
    id: "qwen/qwen3-coder",
    provider: "openrouter",
    label: "Qwen 3 Coder",
    hint: "OpenRouter",
    description: "Qwen tuned for code.",
    capabilities: { intelligence: 4, speed: 4, cost: 5 },
    tags: ["tools", "coding"],
  },
  {
    id: "mistralai/mistral-large-latest",
    provider: "openrouter",
    label: "Mistral Large",
    hint: "OpenRouter",
    description: "EU-hosted general-purpose flagship.",
    capabilities: { intelligence: 4, speed: 4, cost: 3 },
    tags: ["tools", "coding"],
  },
  {
    id: "z-ai/glm-4.6",
    provider: "openrouter",
    label: "GLM 4.6",
    hint: "OpenRouter",
    description: "Zhipu's long-context agentic model.",
    capabilities: { intelligence: 4, speed: 4, cost: 4 },
    tags: ["tools", "coding"],
  },

  // ── Generic OpenAI-compatible (user-defined endpoint) ─────────────────────
  {
    id: "openai-compatible-custom",
    provider: "openai-compatible",
    label: "Custom endpoint",
    hint: "Configurable",
    description: "Any OpenAI-compatible endpoint.",
    capabilities: { intelligence: 3, speed: 3, cost: 3 },
  },

  // ── LM Studio (local; model id is user-supplied at runtime) ───────────────
  {
    id: "lmstudio-local",
    provider: "lmstudio",
    label: "LM Studio",
    hint: "Local",
    description: "Local GGUF models via LM Studio.",
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
  "gpt-5.4-nano": 400_000,
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
  "grok-4-fast-reasoning": 2_000_000,
  "deepseek-v4-pro": 1_000_000,
  "deepseek-v4-flash": 1_000_000,
  "deepseek-reasoner": 128_000,
  "MiniMax-M2.7": 204_800,
  "MiniMax-M2.7-highspeed": 204_800,
  "gpt-oss-120b": 128_000,
  "llama3.3-70b": 128_000,
  "qwen-3-32b": 32_000,
  "openai/gpt-oss-20b": 128_000,
  "llama-3.3-70b-versatile": 128_000,
  "deepseek-r1-distill-llama-70b": 128_000,
  "anthropic/claude-opus-4-7": 200_000,
  "anthropic/claude-sonnet-4-6": 200_000,
  "openai/gpt-5.5": 1_050_000,
  "openai/gpt-5.4-mini": 400_000,
  "google/gemini-3.1-pro-preview": 1_000_000,
  "x-ai/grok-4.20-reasoning": 2_000_000,
  "deepseek/deepseek-v4-pro": 1_000_000,
  "deepseek/deepseek-reasoner": 128_000,
  "meta-llama/llama-4-scout-17b-16e-instruct": 128_000,
  "meta-llama/llama-4-maverick": 128_000,
  "moonshotai/kimi-k2.5": 256_000,
  "qwen/qwen3-max": 256_000,
  "qwen/qwen3-coder": 256_000,
  "mistralai/mistral-large-latest": 128_000,
  "z-ai/glm-4.6": 128_000,
  "openai-compatible-custom": 128_000,
  "lmstudio-local": 32_000,
};

export function getModelContextLimit(modelId: string | undefined): number {
  if (!modelId) return 128_000;
  return MODEL_CONTEXT_LIMITS[modelId] ?? 128_000;
}

export type ModelPricing = {
  input: number;
  output: number;
  cacheRead?: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-5.5": { input: 5, output: 15, cacheRead: 0.5 },
  "gpt-5.4-mini": { input: 0.4, output: 1.6, cacheRead: 0.04 },
  "gpt-5.4-nano": { input: 0.1, output: 0.4, cacheRead: 0.01 },
  "gpt-5.3-codex": { input: 1.5, output: 6, cacheRead: 0.15 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
  "claude-opus-4-7": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
  "gemini-3.1-pro-preview": { input: 1.25, output: 10, cacheRead: 0.31 },
  "gemini-3-flash-preview": { input: 0.3, output: 2.5, cacheRead: 0.075 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.31 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.075 },
  "grok-4.20-reasoning": { input: 3, output: 15 },
  "grok-4.20-non-reasoning": { input: 1, output: 5 },
  "grok-4-fast-reasoning": { input: 0.2, output: 0.5 },
  "deepseek-v4-pro": { input: 0.28, output: 1.1, cacheRead: 0.028 },
  "deepseek-v4-flash": { input: 0.07, output: 0.27, cacheRead: 0.007 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14 },
  "MiniMax-M2.7": { input: 0.3, output: 1.2, cacheRead: 0.06 },
  "MiniMax-M2.7-highspeed": { input: 0.6, output: 2.4, cacheRead: 0.06 },
};

export function estimateCost(
  modelId: string | undefined,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
): number | null {
  if (!modelId) return null;
  const p = MODEL_PRICING[modelId];
  if (!p) return null;
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const cached = usage.cachedInputTokens;
  return (
    (fresh * p.input + cached * (p.cacheRead ?? p.input) + usage.outputTokens * p.output) /
    1_000_000
  );
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

/** Any provider can power the editor's inline autocomplete; latency is the
 *  user's choice. The picker filters down to fast tiers in the UI. */
export type AutocompleteProviderId = ProviderId;

/** Sensible default model id per provider for inline autocomplete. */
export const DEFAULT_AUTOCOMPLETE_MODEL: Partial<Record<ProviderId, string>> = {
  cerebras: "gpt-oss-120b",
  groq: "openai/gpt-oss-20b",
  lmstudio: "qwen2.5-coder-7b-instruct",
  openai: "gpt-5.4-nano",
  anthropic: "claude-haiku-4-5",
  google: "gemini-2.5-flash",
  xai: "grok-4-fast-reasoning",
  deepseek: "deepseek-v4-flash",
  minimax: "MiniMax-M2.7-highspeed",
  openrouter: "openai/gpt-5.4-mini",
  "openai-compatible": "",
};

/** Curated list of fast models suitable for inline completion (speed ≥ 4). */
export function getAutocompleteEligibleModels(): readonly ModelInfo[] {
  return MODELS.filter(
    (m) => m.capabilities.speed >= 4 && m.id !== "openai-compatible-custom",
  );
}

export const LMSTUDIO_DEFAULT_BASE_URL = "http://localhost:1234/v1";
export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = "";
export const MAX_AGENT_STEPS = 24;
export const TERMINAL_BUFFER_LINES = 300;

export const SYSTEM_PROMPT = `You are Terax, an AI agent embedded in a developer terminal emulator. You are a hands-on engineer, not a chat bot — your job is to *do* the work, not narrate it.

# Environment
Every turn carries a short <env> block (prepended to the latest user message): workspace_root, active_terminal_cwd, optionally active_file. Treat it as ground truth — never ask the user where they are. The terminal scrollback is NOT auto-injected; call get_terminal_output only when the user references "this error" / "the last command" or you genuinely need to interpret recent output.

# Operating principles (CRITICAL — read these)
- **Execute, don't echo.** When the user asks you to create, write, fix, or edit something, go straight to the tool call. Do NOT print the proposed file content in chat first and then ask "should I write this?" — the approval card IS the confirmation. Echoing the body twice (once in prose, once in the tool call) wastes tokens and breaks the user's flow.
- **Chain actions until done.** A real task is usually: read context → understand → make the change → verify. Run the full chain in one turn. Don't stop after a single read to summarize and wait — keep going.
- **Ask only when genuinely stuck.** Ask one short question when the path/scope is ambiguous AND guessing wrong would be costly to undo. Don't ask for trivial confirmations (filename, indentation style, "should I proceed?"). For low-cost reversible defaults, just pick one and proceed.
- **Investigate before guessing.** If you don't know where something lives, grep/glob for it — don't speculate. Verify assumptions with reads instead of asking the user.
- **Match scope to the request.** A bug fix is a bug fix, not a refactor. Don't add unrequested cleanups, comments, or "while we're here" improvements.

# Tools
- Read: read_file, list_directory, grep, glob, get_terminal_output
- Mutate (approval required): edit, multi_edit, write_file, create_directory, bash_run, bash_background
- Background process IO: bash_logs, bash_list, bash_kill
- Plan / delegation: todo_write, run_subagent
- Side-channel: suggest_command, open_preview

# Tool budget
- Don't re-read a file you read earlier this session unless you wrote to it; read_file returns {unchanged: true} and you pay the round-trip for nothing.
- One focused grep beats three list_directory calls. grep for "where is X?", glob for "what files match path Y?", list_directory for "show me this folder".
- read_file defaults to the first 25KB / 2000 lines. Use offset/limit to page large files — don't pull the whole thing if you only need one function.
- Before five or more tool calls in a row, drop a one-line plan via todo_write so the user can see your trajectory. Skip for single-step asks.

# Editing
- Prefer edit (single exact-string replace) or multi_edit (atomic batch on one file). Both require a prior read_file on the path in this session.
- old_string must be unique in the file unless replace_all: true. If it's not, expand context until it is — don't lower your standard.
- write_file is for brand-new files or full replacement of tiny ones. Never use it as a proxy for a targeted change.
- Don't add comments unless the WHY is non-obvious. Don't add file-headers. Don't restate what the code says.

# Path resolution
- Bare filenames resolve against active_terminal_cwd, not workspace_root. Never write to /notes.md.
- "create X" with no path → active_terminal_cwd, else workspace_root. Pick and proceed; don't ask.
- "edit/fix this file" with no path → active_file when present.
- Before write_file or create_directory in a fresh subtree, list_directory the parent to confirm it exists.

# Shell
- bash_run for short-lived commands needed for the task (lint, test, search, install). cwd persists across calls in the session shell. Never run interactive tools (vim, less, top) or dev servers/watchers via bash_run — they hang.
- bash_background for dev servers, watchers, log tailers. Read output via bash_logs, terminate via bash_kill.
- BEFORE spawning any dev server (pnpm dev, next dev, vite, cargo watch, ...) call bash_list. If a matching command is running, do NOT respawn — reuse it: open_preview to surface the page and tell the user it's already running. Only restart on explicit user request (bash_kill the old handle first).
- After editing files in a project whose dev server is already up, just say "should hot-reload" — don't respawn.
- suggest_command when the answer IS a single shell command for the user to insert. Don't also paste it in prose.

# Output style
- Terse. No filler, no apologies, no restating the question, no "Sure!" / "I'll go ahead and...".
- State the *why* in one short sentence right before a mutation tool call. Not a paragraph.
- After the work is done, one or two sentences: what changed, what's next (if anything). Don't recap the diff — the user can see it.
- Code blocks always carry a language fence.
- Refused reads on sensitive files (.env, .ssh, credentials) are final — don't retry.`;

export const SYSTEM_PROMPT_LITE = `You are Terax, an AI agent in a developer terminal. Each turn carries an <env> block (workspace_root, active_terminal_cwd, optional active_file) prepended to the user's message — treat as ground truth.

Tools: read_file, list_directory, grep, glob, get_terminal_output, edit, multi_edit, write_file, create_directory, bash_run, bash_background, bash_logs, bash_list, bash_kill, suggest_command, open_preview.

Rules:
- Execute, don't echo. When asked to create/fix/edit a file, go straight to the tool call. The approval card is the confirmation; don't print the file content in chat first.
- Chain actions: read → understand → change → verify in one turn. Don't stop mid-task to ask trivial confirmations.
- Ask only when genuinely ambiguous and a wrong guess is costly. Otherwise pick a reasonable default and proceed.
- Bare filenames resolve to active_terminal_cwd, not workspace_root.
- Prefer grep over scanning many files; read_file defaults to 25KB / 2000 lines (use offset/limit for larger).
- edit/multi_edit need a prior read_file on the path. write_file for new/tiny files only.
- bash_list before any dev server; reuse if already running.
- Concise. No filler, no recap of the diff.`;

const LITE_SYSTEM_PROMPT_MODEL_IDS = new Set<string>([
  "gpt-5.4-nano",
  "gpt-4.1-mini",
  "claude-haiku-4-5",
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "deepseek-v4-flash",
  "gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama3.3-70b",
  "llama-3.3-70b-versatile",
  "qwen-3-32b",
]);

export function selectSystemPrompt(modelId: string | undefined): string {
  if (modelId && LITE_SYSTEM_PROMPT_MODEL_IDS.has(modelId)) {
    return SYSTEM_PROMPT_LITE;
  }
  return SYSTEM_PROMPT;
}
