import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  getModelContextLimit,
  getProvider,
  isCompatModelId,
  type ModelInfo,
  modelKeepsReasoning,
  type ProviderId,
  resolveModel,
} from "@/modules/ai/config";

export type PiAuthMode = "terax" | "profile";

const PROFILE_MODEL_PREFIX = "pi-profile";

export type PiProviderPrefs = {
  piAuthMode: PiAuthMode;
  piModelId: string;
  lmstudioBaseURL: string;
  lmstudioModelId: string;
  mlxBaseURL: string;
  mlxModelId: string;
  ollamaBaseURL: string;
  ollamaModelId: string;
  openaiCompatibleBaseURL: string;
  openaiCompatibleModelId: string;
  openaiCompatibleContextLimit: number;
  openrouterModelId: string;
  customEndpoints: readonly CustomEndpoint[];
};

export const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export function isPiThinkingLevel(value: unknown): value is PiThinkingLevel {
  return PI_THINKING_LEVELS.includes(value as PiThinkingLevel);
}

export type PiProviderRuntimeConfig = {
  authMode: PiAuthMode;
  provider: string;
  modelId: string;
  sourceModelId: string;
  baseUrl?: string;
  contextLimit?: number;
  maxTokens?: number;
  reasoning?: boolean;
  customEndpointId?: string;
  thinkingLevel?: PiThinkingLevel;
  apiKey?: undefined;
};

export type PiProviderResolution =
  | {
      ok: true;
      provider: string;
      providerLabel: string;
      modelLabel: string;
      config: PiProviderRuntimeConfig;
    }
  | {
      ok: false;
      provider: string | null;
      providerLabel: string;
      modelLabel: string;
      error: string;
      config: null;
    };

function trimValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

const ACRONYM_LABELS: Record<string, string> = {
  ai: "AI",
  api: "API",
  gpt: "GPT",
  openai: "OpenAI",
};

function humanizeId(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map(
      (part) =>
        ACRONYM_LABELS[part] ?? part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function providerLabel(provider: string): string {
  try {
    return getProvider(provider as ProviderId).label;
  } catch {
    return humanizeId(provider);
  }
}

export function profileModelSourceId(
  provider: string,
  modelId: string,
): string {
  return `${PROFILE_MODEL_PREFIX}:${provider}:${modelId}`;
}

export function isProfileModelSourceId(sourceModelId: string): boolean {
  return sourceModelId.startsWith(`${PROFILE_MODEL_PREFIX}:`);
}

function parseProfileModelSourceId(
  sourceModelId: string,
): { provider: string; modelId: string } | null {
  const prefix = `${PROFILE_MODEL_PREFIX}:`;
  if (!sourceModelId.startsWith(prefix)) return null;
  const rest = sourceModelId.slice(prefix.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === rest.length - 1) return null;
  return {
    provider: rest.slice(0, separatorIndex),
    modelId: rest.slice(separatorIndex + 1),
  };
}

function incomplete(
  provider: string,
  modelLabel: string,
  error: string,
): PiProviderResolution {
  return {
    ok: false,
    provider,
    providerLabel: providerLabel(provider),
    modelLabel,
    error,
    config: null,
  };
}

function modelRuntimeMetadata(
  model: ModelInfo,
  contextOverride?: number,
): Pick<PiProviderRuntimeConfig, "contextLimit" | "maxTokens" | "reasoning"> {
  const contextLimit = getModelContextLimit(model.id, contextOverride);
  return {
    contextLimit,
    maxTokens: contextLimit,
    reasoning: modelKeepsReasoning(model),
  };
}

function freeformRuntimeMetadata(
  contextLimit: number,
): Pick<PiProviderRuntimeConfig, "contextLimit" | "maxTokens" | "reasoning"> {
  return {
    contextLimit,
    maxTokens: contextLimit,
    reasoning: true,
  };
}

function resolved(
  provider: string,
  modelLabel: string,
  config: PiProviderRuntimeConfig,
): PiProviderResolution {
  return {
    ok: true,
    provider,
    providerLabel: providerLabel(provider),
    modelLabel,
    config,
  };
}

export function piThinkingLevelsForProvider(
  provider: PiProviderResolution,
): readonly PiThinkingLevel[] {
  if (!provider.ok) return [];
  if (provider.config.reasoning === true) return PI_THINKING_LEVELS;

  const modelIds =
    provider.config.authMode === "profile"
      ? [provider.config.modelId]
      : [provider.config.sourceModelId];

  for (const modelId of modelIds) {
    try {
      const model = resolveModel(modelId, []);
      if (model.tags?.includes("reasoning")) return PI_THINKING_LEVELS;
    } catch {
      // Profile catalogs may contain models unknown to Terax. If we cannot
      // prove the model supports reasoning, keep the control hidden.
    }
  }

  return [];
}

function requiredModelId(
  provider: ProviderId,
  modelLabel: string,
  value: string,
): string | PiProviderResolution {
  const modelId = trimValue(value);
  if (modelId) return modelId;
  return incomplete(
    provider,
    modelLabel,
    `${providerLabel(provider)} needs a model id in Settings > Models.`,
  );
}

function resolveCustomEndpoint(
  prefs: PiProviderPrefs,
  sourceModelId: string,
): PiProviderResolution {
  const endpointId = endpointIdFromCompatModel(sourceModelId);
  const endpoint = prefs.customEndpoints.find((item) => item.id === endpointId);
  const provider = "openai-compatible";
  const modelLabel =
    endpoint?.name.trim() || endpoint?.modelId.trim() || "Custom endpoint";
  if (!endpoint) {
    return incomplete(
      provider,
      modelLabel,
      "Custom endpoint was removed. Choose another Pi model in Settings > Models.",
    );
  }
  const modelId = endpoint.modelId.trim();
  const baseUrl = endpoint.baseURL.trim();
  if (!baseUrl || !modelId) {
    return incomplete(
      provider,
      modelLabel,
      `${modelLabel} needs a base URL and model id in Settings > Models.`,
    );
  }
  return resolved(provider, modelLabel, {
    authMode: "terax",
    provider,
    modelId,
    sourceModelId,
    customEndpointId: endpoint.id,
    baseUrl,
    ...freeformRuntimeMetadata(endpoint.contextLimit),
  });
}

export function nextPiModelIdAfterCustomEndpointRemoval(
  currentPiModelId: string,
  removedEndpointId: string,
  remainingEndpoints: readonly CustomEndpoint[],
): string {
  if (currentPiModelId !== compatModelIdForEndpoint(removedEndpointId)) {
    return currentPiModelId;
  }
  const nextEndpoint = remainingEndpoints[0];
  return nextEndpoint
    ? compatModelIdForEndpoint(nextEndpoint.id)
    : DEFAULT_MODEL_ID;
}

export function resolvePiProviderConfig(
  prefs: PiProviderPrefs,
): PiProviderResolution {
  const sourceModelId = trimValue(prefs.piModelId) || DEFAULT_MODEL_ID;
  const profileModel = parseProfileModelSourceId(sourceModelId);
  if (prefs.piAuthMode === "profile") {
    if (!profileModel) {
      return incomplete(
        "pi-profile",
        "Pi profile model",
        "Choose a model from your existing Pi profile.",
      );
    }
    return resolved(profileModel.provider, profileModel.modelId, {
      authMode: "profile",
      provider: profileModel.provider,
      modelId: profileModel.modelId,
      sourceModelId,
    });
  }

  if (profileModel) {
    return incomplete(
      profileModel.provider,
      profileModel.modelId,
      "Turn on existing Pi profile mode or choose a Terax provider model.",
    );
  }

  if (isCompatModelId(sourceModelId)) {
    return resolveCustomEndpoint(prefs, sourceModelId);
  }

  let model;
  try {
    model = resolveModel(sourceModelId, prefs.customEndpoints);
  } catch {
    return incomplete(
      "openai",
      "Pi model",
      "Pi model is unknown. Choose another model in Settings > Models.",
    );
  }

  switch (model.id) {
    case "lmstudio-local": {
      const modelId = requiredModelId(
        "lmstudio",
        model.label,
        prefs.lmstudioModelId,
      );
      if (typeof modelId !== "string") return modelId;
      return resolved("lmstudio", modelId, {
        authMode: "terax",
        provider: "lmstudio",
        modelId,
        sourceModelId,
        baseUrl: trimValue(prefs.lmstudioBaseURL),
        ...modelRuntimeMetadata(model),
      });
    }
    case "mlx-local": {
      const modelId = requiredModelId("mlx", model.label, prefs.mlxModelId);
      if (typeof modelId !== "string") return modelId;
      return resolved("mlx", modelId, {
        authMode: "terax",
        provider: "mlx",
        modelId,
        sourceModelId,
        baseUrl: trimValue(prefs.mlxBaseURL),
        ...modelRuntimeMetadata(model),
      });
    }
    case "ollama-local": {
      const modelId = requiredModelId(
        "ollama",
        model.label,
        prefs.ollamaModelId,
      );
      if (typeof modelId !== "string") return modelId;
      return resolved("ollama", modelId, {
        authMode: "terax",
        provider: "ollama",
        modelId,
        sourceModelId,
        baseUrl: trimValue(prefs.ollamaBaseURL),
        ...modelRuntimeMetadata(model),
      });
    }
    case "openai-compatible-custom": {
      const provider = "openai-compatible";
      const modelId = requiredModelId(
        provider,
        model.label,
        prefs.openaiCompatibleModelId,
      );
      if (typeof modelId !== "string") return modelId;
      const baseUrl = trimValue(prefs.openaiCompatibleBaseURL);
      if (!baseUrl) {
        return incomplete(
          provider,
          model.label,
          "OpenAI Compatible needs a base URL in Settings > Models.",
        );
      }
      return resolved(provider, modelId, {
        authMode: "terax",
        provider,
        modelId,
        sourceModelId,
        baseUrl,
        ...freeformRuntimeMetadata(prefs.openaiCompatibleContextLimit),
      });
    }
    case "openrouter-custom": {
      const provider = "openrouter";
      const modelId = requiredModelId(
        provider,
        model.label,
        prefs.openrouterModelId,
      );
      if (typeof modelId !== "string") return modelId;
      return resolved(provider, modelId, {
        authMode: "terax",
        provider,
        modelId,
        sourceModelId,
        ...modelRuntimeMetadata(model),
      });
    }
    default:
      return resolved(model.provider, model.label, {
        authMode: "terax",
        provider: model.provider,
        modelId: model.id,
        sourceModelId,
        ...modelRuntimeMetadata(model),
      });
  }
}
