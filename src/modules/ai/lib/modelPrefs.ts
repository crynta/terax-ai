import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setFavoriteModelIds,
  setRecentModelIds,
} from "@/modules/settings/store";

const RECENTS_MAX = 5;

export async function toggleFavoriteModel(id: string): Promise<void> {
  const current = usePreferencesStore.getState().favoriteModelIds;
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  await setFavoriteModelIds(next);
}

export async function pushRecentModel(id: string): Promise<void> {
  const current = usePreferencesStore.getState().recentModelIds;
  const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENTS_MAX);
  if (
    next.length === current.length &&
    next.every((x, i) => x === current[i])
  ) {
    return;
  }
  await setRecentModelIds(next);
}
