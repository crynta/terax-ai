import {
  deletePassword,
  getPassword,
  setPassword,
} from "tauri-plugin-keyring-api";

const SERVICE = "terax-ai";
const ACCOUNT_OPENAI = "openai-api-key";

/**
 * BYOK store for AI provider credentials. Keys live in the OS keychain
 * (Keychain on macOS, libsecret on Linux, Credential Manager on Windows)
 * via tauri-plugin-keyring — they are never written to disk in plaintext
 * by the app.
 *
 * The renderer reads the key just-in-time before each API call. We avoid
 * holding it in long-lived module state so that an extension/devtools
 * inspector can't lift it from a stale cache.
 */
export async function getOpenAiKey(): Promise<string | null> {
  try {
    const v = await getPassword(SERVICE, ACCOUNT_OPENAI);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setOpenAiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await setPassword(SERVICE, ACCOUNT_OPENAI, trimmed);
}

export async function clearOpenAiKey(): Promise<void> {
  try {
    await deletePassword(SERVICE, ACCOUNT_OPENAI);
  } catch {
    // already absent — fine
  }
}

export async function hasOpenAiKey(): Promise<boolean> {
  return (await getOpenAiKey()) !== null;
}
