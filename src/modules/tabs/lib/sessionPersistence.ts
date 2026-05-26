import { LazyStore } from "@tauri-apps/plugin-store";
import { deserializeSession, type RestoredInitial } from "./sessionDeserialize";
import type { SessionV1 } from "./sessionSchema";

const SESSIONS_STORE_PATH = "terax-sessions.json";
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const store = new LazyStore(SESSIONS_STORE_PATH, {
  defaults: {},
  autoSave: 200,
});

/**
 * Drop entries older than PRUNE_AGE_MS. Best-effort: failures are swallowed
 * so a corrupted entry can't block restore of unrelated keys.
 */
async function pruneOldSessions(): Promise<void> {
  try {
    const keys = await store.keys();
    const now = Date.now();
    for (const key of keys) {
      const value = await store.get<SessionV1 | undefined>(key);
      if (!value || typeof value !== "object") continue;
      const updatedAt = (value as SessionV1).updatedAt;
      if (typeof updatedAt !== "number") continue;
      if (now - updatedAt > PRUNE_AGE_MS) {
        await store.delete(key);
      }
    }
  } catch (e) {
    console.warn("[session] prune failed", e);
  }
}

export async function loadSession(
  key: string,
  startId: number,
): Promise<RestoredInitial | null> {
  // Prune in the background; do not block the caller.
  void pruneOldSessions();
  try {
    const raw = await store.get<SessionV1 | undefined>(key);
    if (raw === undefined) return null;
    return deserializeSession(raw, startId);
  } catch (e) {
    console.warn("[session] load failed", e);
    return null;
  }
}

export async function saveSession(
  key: string,
  session: SessionV1,
): Promise<void> {
  try {
    await store.set(key, session);
  } catch (e) {
    console.warn("[session] save failed", e);
  }
}

export async function clearSession(key: string): Promise<void> {
  try {
    await store.delete(key);
  } catch (e) {
    console.warn("[session] clear failed", e);
  }
}
