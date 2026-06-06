import { createOpenAIAudioWorkflowProviderAdapter } from "./openAiAudioAdapter";
import { createOpenAIImageWorkflowProviderAdapter } from "./openAiMediaAdapter";
import { createOpenAIVideoWorkflowProviderAdapter } from "./openAiVideoAdapter";
import {
  listWorkflowProviderAdapters,
  registerWorkflowProviderAdapter,
} from "./providerAdapter";

export type DefaultWorkflowMediaAdapterOptions = {
  getOpenAIApiKey: () => string | null | undefined;
  fetch?: typeof fetch;
};

export function registerDefaultWorkflowMediaAdapters(
  options: DefaultWorkflowMediaAdapterOptions,
): () => void {
  const cleanups: Array<() => void> = [];

  if (!hasWorkflowProviderAdapter("openai-image")) {
    cleanups.push(
      registerWorkflowProviderAdapter(
        createOpenAIImageWorkflowProviderAdapter({
          fetch: options.fetch,
          getApiKey: options.getOpenAIApiKey,
        }),
      ),
    );
  }

  if (!hasWorkflowProviderAdapter("openai-audio")) {
    cleanups.push(
      registerWorkflowProviderAdapter(
        createOpenAIAudioWorkflowProviderAdapter({
          fetch: options.fetch,
          getApiKey: options.getOpenAIApiKey,
        }),
      ),
    );
  }

  if (!hasWorkflowProviderAdapter("openai-video")) {
    cleanups.push(
      registerWorkflowProviderAdapter(
        createOpenAIVideoWorkflowProviderAdapter({
          fetch: options.fetch,
          getApiKey: options.getOpenAIApiKey,
        }),
      ),
    );
  }

  if (cleanups.length === 0) return noop;
  return () => {
    for (const cleanup of cleanups.slice().reverse()) cleanup();
  };
}

function hasWorkflowProviderAdapter(id: string): boolean {
  return listWorkflowProviderAdapters().some((adapter) => adapter.id === id);
}

function noop() {}
