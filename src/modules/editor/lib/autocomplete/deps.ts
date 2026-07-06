// Shared plumbing for every AI-autocomplete consumer (editor ghost text,
// terminal command suggestions): resolves the configured provider's API key
// and snapshots the preference state into CompletionDeps.

import { endpointIdFromCompatModel } from "@/modules/ai/config";
import { getCustomEndpointKey, getKey } from "@/modules/ai/lib/keyring";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import type { CompletionDeps } from "./provider";

/** One-shot API-key lookup for the currently configured autocomplete
 *  provider (local providers need none; compat keys are per-endpoint). */
export async function resolveAutocompleteApiKey(): Promise<string | null> {
  const s = usePreferencesStore.getState();
  const provider = s.autocompleteProvider;
  if (provider === "lmstudio" || provider === "mlx" || provider === "ollama") {
    return null;
  }
  if (provider === "openai-compatible") {
    const eid = endpointIdFromCompatModel(s.autocompleteModelId);
    return eid ? await getCustomEndpointKey(eid) : null;
  }
  return getKey(provider);
}

/** Keeps the key fresh across keyring writes and provider/model changes. */
export function createAutocompleteKeyWatcher(
  onKey: (key: string | null) => void,
): { dispose: () => void } {
  let cancelled = false;
  const refresh = async () => {
    const k = await resolveAutocompleteApiKey();
    if (!cancelled) onKey(k);
  };
  void refresh();

  let unlistenKeys: (() => void) | undefined;
  void onKeysChanged(() => void refresh()).then((un) => {
    unlistenKeys = un;
  });
  const unsubPrefs = usePreferencesStore.subscribe((state, prev) => {
    if (
      state.autocompleteProvider !== prev.autocompleteProvider ||
      state.autocompleteModelId !== prev.autocompleteModelId
    ) {
      void refresh();
    }
  });

  return {
    dispose: () => {
      cancelled = true;
      unlistenKeys?.();
      unsubPrefs();
    },
  };
}

/** Current autocomplete preferences flattened into request deps. */
export function snapshotAutocompletePrefs(
  apiKey: string | null,
): { enabled: boolean } & CompletionDeps {
  const s = usePreferencesStore.getState();
  const p = s.autocompleteProvider;
  // autocompleteModelId holds the compat- id of the chosen endpoint.
  const compatEp =
    p === "openai-compatible"
      ? s.customEndpoints.find(
          (e) => e.id === endpointIdFromCompatModel(s.autocompleteModelId),
        )
      : undefined;
  const modelId =
    p === "lmstudio"
      ? s.lmstudioModelId
      : p === "mlx"
        ? s.mlxModelId
        : p === "ollama"
          ? s.ollamaModelId
          : p === "openai-compatible"
            ? (compatEp?.modelId ?? "")
            : p === "openrouter"
              ? s.openrouterModelId
              : s.autocompleteModelId;
  return {
    enabled: s.autocompleteEnabled,
    provider: p,
    modelId,
    apiKey,
    lmstudioBaseURL: s.lmstudioBaseURL,
    mlxBaseURL: s.mlxBaseURL,
    ollamaBaseURL: s.ollamaBaseURL,
    openaiCompatibleBaseURL: compatEp?.baseURL ?? s.openaiCompatibleBaseURL,
  };
}
