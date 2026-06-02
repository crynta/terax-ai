import {
  type CustomEndpoint,
  DEFAULT_MODEL_ID,
  endpointIdFromCompatModel,
  getProvider,
  isCompatModelId,
  type ProviderId,
  resolveModel,
} from "@/modules/ai/config";

export type PiProviderPrefs = {
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

export type PiProviderRuntimeConfig = {
  provider: ProviderId;
  modelId: string;
  sourceModelId: string;
  baseUrl?: string;
  contextLimit?: number;
  customEndpointId?: string;
  apiKey?: undefined;
};

export type PiProviderResolution =
  | {
      ok: true;
      provider: ProviderId;
      providerLabel: string;
      modelLabel: string;
      config: PiProviderRuntimeConfig;
    }
  | {
      ok: false;
      provider: ProviderId | null;
      providerLabel: string;
      modelLabel: string;
      error: string;
      config: null;
    };

function trimValue(value: string | undefined): string {
  return value?.trim() ?? "";
}

function providerLabel(provider: ProviderId): string {
  return getProvider(provider).label;
}

function incomplete(
  provider: ProviderId,
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

function resolved(
  provider: ProviderId,
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
    provider,
    modelId,
    sourceModelId,
    customEndpointId: endpoint.id,
    baseUrl,
    contextLimit: endpoint.contextLimit,
  });
}

export function resolvePiProviderConfig(
  prefs: PiProviderPrefs,
): PiProviderResolution {
  const sourceModelId = trimValue(prefs.piModelId) || DEFAULT_MODEL_ID;
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
        provider: "lmstudio",
        modelId,
        sourceModelId,
        baseUrl: trimValue(prefs.lmstudioBaseURL),
      });
    }
    case "mlx-local": {
      const modelId = requiredModelId("mlx", model.label, prefs.mlxModelId);
      if (typeof modelId !== "string") return modelId;
      return resolved("mlx", modelId, {
        provider: "mlx",
        modelId,
        sourceModelId,
        baseUrl: trimValue(prefs.mlxBaseURL),
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
        provider: "ollama",
        modelId,
        sourceModelId,
        baseUrl: trimValue(prefs.ollamaBaseURL),
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
        provider,
        modelId,
        sourceModelId,
        baseUrl,
        contextLimit: prefs.openaiCompatibleContextLimit,
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
        provider,
        modelId,
        sourceModelId,
      });
    }
    default:
      return resolved(model.provider, model.label, {
        provider: model.provider,
        modelId: model.id,
        sourceModelId,
      });
  }
}
