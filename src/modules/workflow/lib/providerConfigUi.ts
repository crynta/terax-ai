import {
  type CustomEndpoint,
  MODELS,
  PROVIDERS,
  providerNeedsKey,
} from "@/modules/ai/config";
import type { WorkflowNode, WorkflowNodeType } from "./schema";

export type WorkflowProviderCredentialStatus = {
  status: "configured" | "missing" | "not-required";
  label: string;
  providerLabel: string;
};

export type WorkflowProviderSettingField = {
  key: string;
  label: string;
  kind: "text" | "number" | "select";
  placeholder?: string;
  options?: string[];
};

export type WorkflowDiscoveredProviderModels = Partial<
  Record<string, string[]>
>;

export type WorkflowProviderOption = {
  id: string;
  label: string;
  requiresKey: boolean;
  models: string[];
  credentialKey?: string;
  helpText?: string;
};

export type WorkflowProviderKeyMap = Partial<
  Record<string, string | null | undefined>
>;

export type WorkflowDiscoveredProviderModelsInput = {
  apiKeys?: WorkflowProviderKeyMap;
  customEndpoints?: readonly CustomEndpoint[];
};

const generationNodeTypes = new Set<WorkflowNodeType>([
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
]);

const openAIImageSettings: WorkflowProviderSettingField[] = [
  {
    key: "size",
    label: "Size",
    kind: "select",
    options: ["1024x1024", "1536x1024", "1024x1536"],
  },
  {
    key: "quality",
    label: "Quality",
    kind: "select",
    options: ["auto", "low", "medium", "high"],
  },
  {
    key: "outputFormat",
    label: "Output format",
    kind: "select",
    options: ["png", "jpeg", "webp"],
  },
];

const openAIVideoSettings: WorkflowProviderSettingField[] = [
  {
    key: "size",
    label: "Size",
    kind: "select",
    options: ["720x1280", "1280x720"],
  },
  { key: "seconds", label: "Seconds", kind: "number", placeholder: "5" },
  {
    key: "quality",
    label: "Quality",
    kind: "select",
    options: ["standard", "high"],
  },
];

const openAIAudioSettings: WorkflowProviderSettingField[] = [
  {
    key: "voice",
    label: "Voice",
    kind: "select",
    options: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer"],
  },
  {
    key: "responseFormat",
    label: "Format",
    kind: "select",
    options: ["mp3", "wav", "opus", "aac", "flac"],
  },
];

const providerOptionsByNodeType: Partial<
  Record<WorkflowNodeType, WorkflowProviderOption[]>
> = {
  imageGeneration: [
    {
      id: "openai",
      label: "OpenAI",
      requiresKey: true,
      credentialKey: "openai",
      helpText:
        "Uses the OpenAI Images API and stores binary artifacts durably.",
      models: ["gpt-image-2", "gpt-image-1"],
    },
    {
      id: "placeholder",
      label: "Placeholder",
      requiresKey: false,
      models: ["image"],
    },
  ],
  videoGeneration: [
    {
      id: "openai",
      label: "OpenAI",
      requiresKey: true,
      credentialKey: "openai",
      helpText:
        "Uses the OpenAI Videos API with polling and artifact download.",
      models: ["sora-2", "sora-2-pro"],
    },
    {
      id: "placeholder",
      label: "Placeholder",
      requiresKey: false,
      models: ["video"],
    },
  ],
  audioGeneration: [
    {
      id: "openai",
      label: "OpenAI",
      requiresKey: true,
      credentialKey: "openai",
      helpText: "Uses OpenAI text-to-speech compatible audio generation.",
      models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    },
    {
      id: "local",
      label: "Local",
      requiresKey: false,
      models: ["audio"],
    },
    {
      id: "placeholder",
      label: "Placeholder",
      requiresKey: false,
      models: ["audio"],
    },
  ],
};

const providerSettingsByNodeAndProvider: Partial<
  Record<WorkflowNodeType, Record<string, WorkflowProviderSettingField[]>>
> = {
  imageGeneration: { openai: openAIImageSettings },
  videoGeneration: { openai: openAIVideoSettings },
  audioGeneration: { openai: openAIAudioSettings },
};

export function workflowDiscoveredProviderModelsFromAiConfig({
  apiKeys = {},
  customEndpoints = [],
}: WorkflowDiscoveredProviderModelsInput): WorkflowDiscoveredProviderModels {
  const enabledProviders = new Set<string>();
  for (const provider of PROVIDERS) {
    const key = apiKeys[provider.id];
    const hasKey = typeof key === "string" && key.trim().length > 0;
    if (!providerNeedsKey(provider.id) || hasKey) {
      enabledProviders.add(provider.id);
    }
  }

  const discovered: Record<string, string[]> = {};
  for (const model of MODELS) {
    if (!enabledProviders.has(model.provider)) continue;
    appendDiscoveredModel(discovered, model.provider, model.id);
  }
  for (const endpoint of customEndpoints) {
    if (!endpoint.modelId.trim()) continue;
    appendDiscoveredModel(
      discovered,
      "openai-compatible",
      endpoint.modelId.trim(),
    );
  }
  return discovered;
}

export function workflowProviderOptionsForNode(
  type: WorkflowNodeType,
  discoveredModels: WorkflowDiscoveredProviderModels = {},
): WorkflowProviderOption[] {
  const baseOptions = providerOptionsByNodeType[type] ?? [];
  if (!generationNodeTypes.has(type)) return baseOptions;

  const baseProviderIds = new Set(baseOptions.map((option) => option.id));
  const discoveredOptions = Object.keys(discoveredModels)
    .filter((provider) => !baseProviderIds.has(provider))
    .sort((left, right) =>
      providerLabel(left).localeCompare(providerLabel(right)),
    )
    .map(
      (provider): WorkflowProviderOption => ({
        id: provider,
        label: providerLabel(provider),
        requiresKey: providerRequiresKey(provider),
        credentialKey: provider,
        helpText:
          "Configured model provider. Media generation uses a dedicated adapter when available, otherwise the workflow placeholder adapter keeps runs deterministic.",
        models: discoveredModels[provider] ?? [],
      }),
    );

  return [...baseOptions, ...discoveredOptions];
}

export function workflowProviderModelOptions(
  node: WorkflowNode,
  provider = providerConfig(node),
  discoveredModels: WorkflowDiscoveredProviderModels = {},
): string[] {
  const builtIn =
    workflowProviderOptionsForNode(node.type, discoveredModels).find(
      (option) => option.id === provider,
    )?.models ?? [];
  const discovered = discoveredModels[provider] ?? [];
  return [...new Set([...builtIn, ...discovered])];
}

export function workflowProviderSettingsForNode(
  type: WorkflowNodeType,
  provider: string,
): WorkflowProviderSettingField[] {
  return providerSettingsByNodeAndProvider[type]?.[provider] ?? [];
}

export function workflowProviderCredentialStatus(
  provider: string,
  keys: WorkflowProviderKeyMap,
): WorkflowProviderCredentialStatus {
  const option = providerOptionById(provider);
  const providerLabel = option?.label ?? provider;
  if (!option?.requiresKey) {
    return { label: "No key required", providerLabel, status: "not-required" };
  }

  const keyName = option.credentialKey ?? provider;
  const configured =
    typeof keys[keyName] === "string" && keys[keyName].trim().length > 0;
  const label = `${option.label} key ${configured ? "configured" : "missing"}`;
  return {
    label,
    providerLabel,
    status: configured ? "configured" : "missing",
  };
}

function providerConfig(node: WorkflowNode): string {
  return typeof node.config.provider === "string"
    ? node.config.provider.trim().toLowerCase()
    : "";
}

function providerOptionById(provider: string): WorkflowProviderOption | null {
  const normalized = provider.trim().toLowerCase();
  for (const options of Object.values(providerOptionsByNodeType)) {
    const option = options?.find((candidate) => candidate.id === normalized);
    if (option) return option;
  }

  const aiProvider = PROVIDERS.find((candidate) => candidate.id === normalized);
  if (!aiProvider) return null;
  return {
    id: aiProvider.id,
    label: aiProvider.label,
    requiresKey: providerNeedsKey(aiProvider.id),
    credentialKey: aiProvider.id,
    models: [],
  };
}

function appendDiscoveredModel(
  discovered: Record<string, string[]>,
  provider: string,
  model: string,
): void {
  discovered[provider] ??= [];
  if (!discovered[provider].includes(model)) discovered[provider].push(model);
}

function providerLabel(provider: string): string {
  return (
    PROVIDERS.find((candidate) => candidate.id === provider)?.label ??
    provider
      .split(/[-_\s]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function providerRequiresKey(provider: string): boolean {
  const aiProvider = PROVIDERS.find((candidate) => candidate.id === provider);
  return aiProvider ? providerNeedsKey(aiProvider.id) : false;
}
