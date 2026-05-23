import { useEffect, useRef } from "react";
import {
  DEFAULT_MODEL_ID,
  makeOpenAICompatibleId,
  parseOpenAICompatibleModelIds,
  type ModelId,
} from "../config";
import {
  setDefaultModel,
  setFavoriteModelIds,
  setRecentModelIds,
} from "@/modules/settings/store";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useChatStore } from "../store/chatStore";

/**
 * Keep model-id references consistent when the user removes a model from the
 * OpenAI-compatible list. Without this, `chatStore.selectedModelId` /
 * `defaultModelId` / `recentModelIds` / `favoriteModelIds` can point at a
 * synthesized id that no longer exists, and the next `getModel(id)` throws.
 *
 * The hook is a no-op until preferences hydrate, and a no-op on calls that
 * only *add* ids — reconciliation work only happens when ids actually vanish.
 */
export function useCompatReconciler(): void {
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const compatRaw = usePreferencesStore((s) => s.openaiCompatibleModelId);
  const defaultModelId = usePreferencesStore((s) => s.defaultModelId);
  const previousIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const upstreamIds = parseOpenAICompatibleModelIds(compatRaw);
    const namespaced = new Set(upstreamIds.map(makeOpenAICompatibleId));

    const previous = previousIdsRef.current;
    previousIdsRef.current = namespaced;
    if (previous === null) return; // First observation — nothing to reconcile.

    const removed = new Set<string>();
    for (const id of previous) if (!namespaced.has(id)) removed.add(id);
    if (removed.size === 0) return;

    const prefs = usePreferencesStore.getState();
    const chat = useChatStore.getState();

    if (removed.has(chat.selectedModelId)) {
      const fallback = removed.has(defaultModelId)
        ? DEFAULT_MODEL_ID
        : (defaultModelId as ModelId);
      chat.setSelectedModelId(fallback);
    }

    const trimmedRecents = prefs.recentModelIds.filter((id) => !removed.has(id));
    if (trimmedRecents.length !== prefs.recentModelIds.length) {
      void setRecentModelIds(trimmedRecents);
    }

    const trimmedFavorites = prefs.favoriteModelIds.filter(
      (id) => !removed.has(id),
    );
    if (trimmedFavorites.length !== prefs.favoriteModelIds.length) {
      void setFavoriteModelIds(trimmedFavorites);
    }

    if (removed.has(defaultModelId)) {
      void setDefaultModel(DEFAULT_MODEL_ID);
    }
  }, [hydrated, compatRaw, defaultModelId]);
}
