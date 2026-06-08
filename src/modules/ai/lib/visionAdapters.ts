import type { UIMessage } from "@ai-sdk/react";
import { isCompatModelId, resolveModel, type ModelInfo, type ProviderId } from "../config";

type PartLike = { type?: string; mediaType?: unknown };

export type VisionProviderAdapter = {
  provider: ProviderId;
  acceptsImages: (model: ModelInfo) => boolean;
};

const tagVision = (model: ModelInfo) => model.tags?.includes("vision") ?? false;

export const VISION_PROVIDER_ADAPTERS: Partial<Record<ProviderId, VisionProviderAdapter>> = {
  openai: { provider: "openai", acceptsImages: tagVision },
  anthropic: { provider: "anthropic", acceptsImages: tagVision },
  google: { provider: "google", acceptsImages: tagVision },
  openrouter: { provider: "openrouter", acceptsImages: tagVision },
  "openai-compatible": {
    provider: "openai-compatible",
    acceptsImages: () => true,
  },
  lmstudio: { provider: "lmstudio", acceptsImages: () => true },
  mlx: { provider: "mlx", acceptsImages: () => true },
  ollama: { provider: "ollama", acceptsImages: () => true },
};

export function modelSupportsImages(
  modelId: string,
  endpoints: Parameters<typeof resolveModel>[1] = [],
): boolean {
  if (isCompatModelId(modelId)) return true;
  const model = resolveModel(modelId, endpoints);
  return VISION_PROVIDER_ADAPTERS[model.provider]?.acceptsImages(model) ?? false;
}

export function messageHasImageParts(message: UIMessage): boolean {
  return message.parts.some((p: PartLike) => {
    return p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image/");
  });
}

export function stripImagePartsForPersistence(messages: UIMessage[]): UIMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (!messageHasImageParts(message)) return message;
    changed = true;
    return {
      ...message,
      parts: message.parts.filter((p: PartLike) => {
        return !(p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image/"));
      }),
    } as UIMessage;
  });
  return changed ? next : messages;
}
