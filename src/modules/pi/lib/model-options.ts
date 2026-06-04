import {
  MODELS,
  type ModelInfo,
  type ProviderId,
  type ProviderInfo,
  PROVIDERS,
} from "@/modules/ai/config";
import type { PiProfileModelsList } from "@/modules/pi/lib/native";

export type PiProfileModelGroup = {
  provider: string;
  providerLabel: string;
  models: PiProfileModelsList["models"];
};

export function getPiProfileModelGroups(
  catalog: PiProfileModelsList | null,
): PiProfileModelGroup[] {
  const groups = new Map<string, PiProfileModelsList["models"]>();
  for (const model of catalog?.models ?? []) {
    if (!model.available) continue;
    const models = groups.get(model.provider) ?? [];
    models.push(model);
    groups.set(model.provider, models);
  }
  return Array.from(groups.entries()).map(([provider, models]) => ({
    provider,
    providerLabel: models[0]?.providerLabel ?? provider,
    models,
  }));
}

export function countHiddenPiProfileModels(
  catalog: PiProfileModelsList | null,
): number {
  return (catalog?.models ?? []).filter((model) => !model.available).length;
}

export type PiModelProviderGroup = {
  provider: ProviderInfo;
  models: readonly ModelInfo[];
  setupRequired: boolean;
};

export function getPiModelProviderGroups(
  configuredIds: ReadonlySet<ProviderId>,
): PiModelProviderGroup[] {
  return PROVIDERS.filter((provider) => configuredIds.has(provider.id))
    .map((provider) => ({
      provider,
      models: MODELS.filter((model) => model.provider === provider.id),
      setupRequired: false,
    }))
    .filter((group) => group.models.length > 0);
}

export function countHiddenPiProviderModels(
  configuredIds: ReadonlySet<ProviderId>,
): number {
  return MODELS.filter((model) => !configuredIds.has(model.provider)).length;
}
