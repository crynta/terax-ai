import {
  MODELS,
  type ModelInfo,
  PROVIDERS,
  type ProviderId,
  type ProviderInfo,
} from "@/modules/ai/config";
import type { PiProfileModelsList } from "@/modules/pi/lib/native";

export type PiModelFilterOptions = {
  query?: string;
  showUnavailable?: boolean;
};

export type PiProfileModelGroup = {
  provider: string;
  providerLabel: string;
  models: PiProfileModelsList["models"];
};

export function getPiProfileModelGroups(
  catalog: PiProfileModelsList | null,
  options: PiModelFilterOptions = {},
): PiProfileModelGroup[] {
  const query = normalizeModelQuery(options.query);
  const groups = new Map<string, PiProfileModelsList["models"]>();
  for (const model of catalog?.models ?? []) {
    if (!options.showUnavailable && !model.available) continue;
    if (!profileModelMatchesQuery(model, query)) continue;
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
  options: PiModelFilterOptions = {},
): number {
  if (options.showUnavailable) return 0;
  const query = normalizeModelQuery(options.query);
  return (catalog?.models ?? []).filter(
    (model) => !model.available && profileModelMatchesQuery(model, query),
  ).length;
}

export type PiModelProviderGroup = {
  provider: ProviderInfo;
  models: readonly ModelInfo[];
  setupRequired: boolean;
};

export function getPiModelProviderGroups(
  configuredIds: ReadonlySet<ProviderId>,
  options: PiModelFilterOptions = {},
): PiModelProviderGroup[] {
  const query = normalizeModelQuery(options.query);
  return PROVIDERS.filter(
    (provider) => options.showUnavailable || configuredIds.has(provider.id),
  )
    .map((provider) => ({
      provider,
      models: MODELS.filter(
        (model) =>
          model.provider === provider.id &&
          providerModelMatchesQuery(model, query),
      ),
      setupRequired: !configuredIds.has(provider.id),
    }))
    .filter((group) => group.models.length > 0);
}

export function countHiddenPiProviderModels(
  configuredIds: ReadonlySet<ProviderId>,
  options: PiModelFilterOptions = {},
): number {
  if (options.showUnavailable) return 0;
  const query = normalizeModelQuery(options.query);
  return MODELS.filter(
    (model) =>
      !configuredIds.has(model.provider) &&
      providerModelMatchesQuery(model, query),
  ).length;
}

function normalizeModelQuery(query: string | undefined): string {
  return query?.trim().toLowerCase() ?? "";
}

function profileModelMatchesQuery(
  model: PiProfileModelsList["models"][number],
  query: string,
): boolean {
  if (!query) return true;
  return [model.id, model.label, model.provider, model.providerLabel].some(
    (value) => value.toLowerCase().includes(query),
  );
}

function providerModelMatchesQuery(model: ModelInfo, query: string): boolean {
  if (!query) return true;
  const provider = PROVIDERS.find((item) => item.id === model.provider);
  return [
    model.id,
    model.label,
    model.hint,
    model.description,
    model.provider,
    provider?.label ?? "",
    ...(model.tags ?? []),
  ].some((value) => value.toLowerCase().includes(query));
}
