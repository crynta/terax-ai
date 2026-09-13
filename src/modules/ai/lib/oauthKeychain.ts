import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "../config";
import { proxyFetch } from "./proxyFetch";

/** Windows Credential Manager blob cap is 2560 bytes. keyring stores
 *  passwords as UTF-16, so the usable ASCII limit is 1280 chars. */
export const WIN_CREDENTIAL_MAX_CHARS = 1280;

export function splitForCredential(
  value: string,
  maxChars = WIN_CREDENTIAL_MAX_CHARS,
): string[] {
  if (value.length === 0) return [""];
  if (value.length <= maxChars) return [value];
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += maxChars) {
    parts.push(value.slice(i, i + maxChars));
  }
  return parts;
}

export function partAccount(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

export function joinParts(
  map: Record<string, string | null | undefined>,
  prefix: string,
  count: number,
): string | null {
  if (!Number.isInteger(count) || count < 1) return null;
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = map[partAccount(prefix, i)];
    if (typeof part !== "string" || part.length === 0) return null;
    chunks.push(part);
  }
  return chunks.join("");
}

export function oauthPartAccounts(
  accessPrefix: string,
  accessParts: number,
  refreshPrefix: string,
  refreshParts: number,
): string[] {
  const accounts: string[] = [];
  for (let i = 0; i < accessParts; i++) {
    accounts.push(partAccount(accessPrefix, i));
  }
  for (let i = 0; i < refreshParts; i++) {
    accounts.push(partAccount(refreshPrefix, i));
  }
  return accounts;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Request aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Request aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function oauthErrorMessage(body: unknown, fallback: string): string {
  const o =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  const str = (v: unknown) =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  return (
    str(o?.error_description) ?? str(o?.error) ?? str(o?.message) ?? fallback
  );
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export async function postForm(
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const res = await proxyFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(fields).toString(),
    signal,
  });
  return { status: res.status, body: await readJson(res) };
}

export async function secretGet(account: string): Promise<string | null> {
  try {
    const raw = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account,
    });
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function secretSet(
  account: string,
  password: string,
): Promise<void> {
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account,
    password,
  });
}

export async function secretDelete(account: string): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account,
    });
  } catch {
    // already absent
  }
}
