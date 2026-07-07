export const OPENCLICKY_AI_TOOLS_STORAGE_KEY =
  "terax.experimental.openclickyAiTools";
export const TTS_READ_ALOUD_STORAGE_KEY = "terax.experimental.ttsReadAloud";

function browserStorage(): Pick<Storage, "getItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function enabledByStorage(
  key: string,
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): boolean {
  try {
    const value = storage?.getItem(key)?.trim().toLowerCase();
    return value === "1" || value === "true" || value === "on";
  } catch {
    return false;
  }
}

export function areOpenClickyAiToolsEnabled(
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  return enabledByStorage(OPENCLICKY_AI_TOOLS_STORAGE_KEY, storage);
}

export function isTtsReadAloudEnabled(
  storage?: Pick<Storage, "getItem"> | null,
): boolean {
  return enabledByStorage(TTS_READ_ALOUD_STORAGE_KEY, storage);
}
