import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  isCompatModelId,
  isKnownModelId,
  MODELS,
  type ModelId,
  PROVIDERS,
  type ProviderId,
  providerNeedsKey,
} from "../config";
import type { ProviderKeys } from "./keyring";

export type ProviderAccess = {
  keys: ProviderKeys;
  openrouterModelId: string;
  lmstudioModelId: string;
  mlxModelId: string;
  ollamaModelId: string;
  openaiCompatibleBaseURL: string;
  openaiCompatibleModelId: string;
};

export function emptyAccess(keys: ProviderKeys): ProviderAccess {
  return {
    keys,
    openrouterModelId: "",
    lmstudioModelId: "",
    mlxModelId: "",
    ollamaModelId: "",
    openaiCompatibleBaseURL: "",
    openaiCompatibleModelId: "",
  };
}

export function isProviderUsable(
  id: ProviderId,
  access: ProviderAccess,
): boolean {
  if (id === "openrouter") {
    return (
      !!access.keys.openrouter && access.openrouterModelId.trim().length > 0
    );
  }
  if (id === "openai-compatible") {
    return (
      access.openaiCompatibleBaseURL.trim().length > 0 &&
      access.openaiCompatibleModelId.trim().length > 0
    );
  }
  if (id === "lmstudio") return access.lmstudioModelId.trim().length > 0;
  if (id === "mlx") return access.mlxModelId.trim().length > 0;
  if (id === "ollama") return access.ollamaModelId.trim().length > 0;
  if (providerNeedsKey(id)) return !!access.keys[id];
  return true;
}

export function isEndpointUsable(endpoint: CustomEndpoint): boolean {
  return (
    endpoint.baseURL.trim().length > 0 && endpoint.modelId.trim().length > 0
  );
}

export function isModelUsable(
  modelId: string,
  access: ProviderAccess,
  endpoints: readonly CustomEndpoint[] = [],
): boolean {
  if (isCompatModelId(modelId)) {
    const id = endpointIdFromCompatModel(modelId);
    const ep = endpoints.find((e) => e.id === id);
    return !!ep && isEndpointUsable(ep);
  }
  if (!isKnownModelId(modelId)) return false;
  const model = MODELS.find((m) => m.id === modelId);
  return !!model && isProviderUsable(model.provider, access);
}

export function usableProviders(access: ProviderAccess): ProviderId[] {
  return PROVIDERS.filter(
    (p) => p.id !== "openai-compatible" && isProviderUsable(p.id, access),
  ).map((p) => p.id);
}

/** Catalog models the user can actually send with, in registry order. */
export function usableCatalogModelIds(access: ProviderAccess): ModelId[] {
  return MODELS.filter((m) => isModelUsable(m.id, access)).map((m) => m.id);
}

/**
 * Pick the model that should be selected: the preferred id when it is
 * usable, otherwise the first usable catalog model, otherwise a configured
 * custom endpoint, otherwise the preferred id unchanged.
 */
export function resolveUsableModelId(
  preferred: string,
  access: ProviderAccess,
  endpoints: readonly CustomEndpoint[] = [],
): string {
  if (isModelUsable(preferred, access, endpoints)) return preferred;
  const catalog = usableCatalogModelIds(access);
  if (catalog[0]) return catalog[0];
  const ep = endpoints.find(isEndpointUsable);
  if (ep) return compatModelIdForEndpoint(ep.id);
  return preferred;
}
