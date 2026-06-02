import { SessionProtocolError } from "./session-errors.js";

const INVALID_PARAMS = -32602;
const MIN_CONTEXT_LIMIT = 1_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const LOCAL_RUNTIME_API_KEY = "terax-local-runtime-key";

const PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "xai",
  "cerebras",
  "groq",
  "deepseek",
  "mistral",
  "openrouter",
  "openai-compatible",
  "lmstudio",
  "mlx",
  "ollama",
]);

const CUSTOM_PROVIDER_BASE_URLS = {
  lmstudio: "http://localhost:1234/v1",
  mlx: "http://127.0.0.1:8080/v1",
  ollama: "http://localhost:11434/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

function protocolError(message) {
  return new SessionProtocolError(INVALID_PARAMS, message);
}

function assertPlainObject(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(`${name} must be an object`);
  }
  return value;
}

function requiredRuntimeString(raw, key) {
  const value = raw[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw protocolError(`providerConfig.${key} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (/\r|\n/.test(trimmed)) {
    throw protocolError(`providerConfig.${key} must not contain newlines`);
  }
  return trimmed;
}

function optionalRuntimeString(raw, key) {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw protocolError(`providerConfig.${key} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (/\r|\n/.test(trimmed)) {
    throw protocolError(`providerConfig.${key} must not contain newlines`);
  }
  return trimmed;
}

function optionalContextLimit(raw) {
  const value = raw.contextLimit;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < MIN_CONTEXT_LIMIT) {
    throw protocolError(
      `providerConfig.contextLimit must be at least ${MIN_CONTEXT_LIMIT}`,
    );
  }
  return Math.round(value);
}

export function normalizeRuntimeProviderConfig(rawConfig) {
  const raw = assertPlainObject(rawConfig, "providerConfig");
  if (raw === undefined) {
    return undefined;
  }

  const provider = requiredRuntimeString(raw, "provider");
  if (!PROVIDERS.has(provider)) {
    throw protocolError(
      `providerConfig.provider is not supported: ${provider}`,
    );
  }

  const config = {
    provider,
    modelId: requiredRuntimeString(raw, "modelId"),
  };
  for (const [key, value] of [
    ["sourceModelId", optionalRuntimeString(raw, "sourceModelId")],
    ["baseUrl", optionalRuntimeString(raw, "baseUrl")],
    ["contextLimit", optionalContextLimit(raw)],
    ["customEndpointId", optionalRuntimeString(raw, "customEndpointId")],
    ["apiKey", optionalRuntimeString(raw, "apiKey")],
  ]) {
    if (value !== undefined) {
      config[key] = value;
    }
  }
  return config;
}

function providerBaseUrl(config) {
  return config.baseUrl ?? CUSTOM_PROVIDER_BASE_URLS[config.provider];
}

function providerNeedsRegistration(registry, config) {
  if (config.baseUrl) {
    return true;
  }
  if (
    ["lmstudio", "mlx", "ollama", "openai-compatible"].includes(config.provider)
  ) {
    return true;
  }
  return !registry.find(config.provider, config.modelId);
}

function runtimeApiKey(config) {
  return config.apiKey ?? LOCAL_RUNTIME_API_KEY;
}

function runtimeProviderConfig(config) {
  const baseUrl = providerBaseUrl(config);
  if (!baseUrl) {
    throw protocolError(
      `providerConfig.baseUrl is required for ${config.provider}/${config.modelId}`,
    );
  }

  return {
    baseUrl,
    apiKey: runtimeApiKey(config),
    api: "openai-completions",
    headers:
      config.provider === "openrouter"
        ? { "HTTP-Referer": "https://terax.ai", "X-Title": "Terax" }
        : undefined,
    models: [
      {
        id: config.modelId,
        name: config.modelId,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.contextLimit ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: Math.min(
          config.contextLimit ?? DEFAULT_CONTEXT_WINDOW,
          DEFAULT_MAX_TOKENS,
        ),
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
      },
    ],
  };
}

export async function createRuntimeProviderOptions(pi, rawConfig) {
  const config = normalizeRuntimeProviderConfig(rawConfig);
  if (config === undefined) {
    return {};
  }

  const authStorage =
    typeof pi.AuthStorage.inMemory === "function"
      ? pi.AuthStorage.inMemory()
      : pi.AuthStorage.create();
  if (config.apiKey) {
    authStorage.setRuntimeApiKey(config.provider, config.apiKey);
  }
  const modelRegistry = pi.ModelRegistry.inMemory(authStorage);

  if (providerNeedsRegistration(modelRegistry, config)) {
    modelRegistry.registerProvider(
      config.provider,
      runtimeProviderConfig(config),
    );
  }

  const model = modelRegistry.find(config.provider, config.modelId);
  if (!model) {
    throw protocolError(
      `providerConfig model is not available: ${config.provider}/${config.modelId}`,
    );
  }

  return { model, authStorage, modelRegistry };
}
