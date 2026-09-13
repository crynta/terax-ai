import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "../config";
import {
  joinParts,
  oauthErrorMessage,
  oauthPartAccounts,
  partAccount,
  postForm,
  readJson,
  secretDelete,
  secretGet,
  secretSet,
  sleep,
  splitForCredential,
  throwIfAborted,
  WIN_CREDENTIAL_MAX_CHARS,
} from "./oauthKeychain";
import { proxyFetch } from "./proxyFetch";

export { WIN_CREDENTIAL_MAX_CHARS };

export const XAI_OAUTH_ACCOUNT = "xai-oauth";
export const XAI_OAUTH_ACCESS_PREFIX = "xai-oauth-access";
export const XAI_OAUTH_REFRESH_PREFIX = "xai-oauth-refresh";
const MAX_STORED_PARTS = 16;
export const XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const XAI_OAUTH_SCOPE =
  "openid profile email offline_access grok-cli:access api:access";
export const XAI_OAUTH_REFRESH_SKEW_MS = 2 * 60 * 1000;

const DEVICE_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const USERINFO_URL = "https://auth.x.ai/oauth2/userinfo";
const REVOKE_URL = "https://auth.x.ai/oauth2/revoke";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_INTERVAL_SEC = 5;
const DEFAULT_EXPIRES_IN_SEC = 1800;
const DEFAULT_TOKEN_EXPIRES_SEC = 3600;

export type XaiOAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  idToken?: string;
  email?: string;
  name?: string;
};

export type XaiDeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  intervalMs: number;
};

export function isXaiApiKey(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("xai-");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function parseOAuthSession(raw: unknown): XaiOAuthSession | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const o = asRecord(value);
  if (!o) return null;
  if (!isNonEmptyString(o.accessToken) || !isNonEmptyString(o.refreshToken)) {
    return null;
  }
  if (typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) {
    return null;
  }
  const session: XaiOAuthSession = {
    accessToken: o.accessToken,
    refreshToken: o.refreshToken,
    expiresAt: o.expiresAt,
  };
  if (isNonEmptyString(o.idToken)) session.idToken = o.idToken;
  if (isNonEmptyString(o.email)) session.email = o.email;
  if (isNonEmptyString(o.name)) session.name = o.name;
  return session;
}

export type OAuthCredentialEntry = {
  account: string;
  password: string;
};

/** Split a session so each Windows credential stays under the UTF-16 byte cap.
 *  id_token is display-only and is not persisted. */
export function sessionToCredentialEntries(
  session: XaiOAuthSession,
  maxChars = WIN_CREDENTIAL_MAX_CHARS,
): OAuthCredentialEntry[] {
  const access = splitForCredential(session.accessToken, maxChars);
  const refresh = splitForCredential(session.refreshToken, maxChars);
  const meta: Record<string, unknown> = {
    expiresAt: session.expiresAt,
    accessParts: access.length,
    refreshParts: refresh.length,
  };
  if (session.email) meta.email = session.email;
  if (session.name) meta.name = session.name;
  return [
    { account: XAI_OAUTH_ACCOUNT, password: JSON.stringify(meta) },
    ...access.map((password, i) => ({
      account: partAccount(XAI_OAUTH_ACCESS_PREFIX, i),
      password,
    })),
    ...refresh.map((password, i) => ({
      account: partAccount(XAI_OAUTH_REFRESH_PREFIX, i),
      password,
    })),
  ];
}

export function sessionFromCredentialMap(
  map: Record<string, string | null | undefined>,
): XaiOAuthSession | null {
  const raw = map[XAI_OAUTH_ACCOUNT];
  if (!raw) return null;
  const combined = parseOAuthSession(raw);
  if (combined) return combined;
  let meta: unknown;
  try {
    meta = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = asRecord(meta);
  if (!o || typeof o.expiresAt !== "number" || !Number.isFinite(o.expiresAt)) {
    return null;
  }
  const access = joinParts(map, XAI_OAUTH_ACCESS_PREFIX, Number(o.accessParts));
  const refresh = joinParts(
    map,
    XAI_OAUTH_REFRESH_PREFIX,
    Number(o.refreshParts),
  );
  if (!access || !refresh) return null;
  const session: XaiOAuthSession = {
    accessToken: access,
    refreshToken: refresh,
    expiresAt: o.expiresAt,
  };
  if (isNonEmptyString(o.email)) session.email = o.email;
  if (isNonEmptyString(o.name)) session.name = o.name;
  return session;
}

export function sessionNeedsRefresh(
  session: Pick<XaiOAuthSession, "expiresAt">,
  now = Date.now(),
): boolean {
  return session.expiresAt - now <= XAI_OAUTH_REFRESH_SKEW_MS;
}

function decodeBase64Url(segment: string): string {
  const pad = "=".repeat((4 - (segment.length % 4)) % 4);
  const b64 = (segment + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function claimsFromIdToken(idToken: string | null | undefined): {
  email?: string;
  name?: string;
} {
  if (!idToken) return {};
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const payload = asRecord(JSON.parse(decodeBase64Url(parts[1])));
    if (!payload) return {};
    const email = isNonEmptyString(payload.email) ? payload.email : undefined;
    const name = isNonEmptyString(payload.name)
      ? payload.name
      : isNonEmptyString(payload.preferred_username)
        ? payload.preferred_username
        : undefined;
    return { email, name };
  } catch {
    return {};
  }
}

/** Display-only: the JWT signature is not verified. */
export function emailFromIdToken(
  idToken: string | null | undefined,
): string | undefined {
  return claimsFromIdToken(idToken).email;
}

export function credentialsFromTokenResponse(
  body: unknown,
  previous?: Pick<XaiOAuthSession, "refreshToken" | "email" | "name">,
  now = Date.now(),
): XaiOAuthSession | null {
  const o = asRecord(body);
  if (!o || !isNonEmptyString(o.access_token)) return null;
  const refresh = isNonEmptyString(o.refresh_token)
    ? o.refresh_token
    : (previous?.refreshToken ?? "");
  if (!refresh) return null;
  const expiresInRaw =
    typeof o.expires_in === "number" ? o.expires_in : Number(o.expires_in);
  const expiresIn =
    Number.isFinite(expiresInRaw) && expiresInRaw > 0
      ? expiresInRaw
      : DEFAULT_TOKEN_EXPIRES_SEC;
  const idToken = isNonEmptyString(o.id_token) ? o.id_token : undefined;
  const fromId = claimsFromIdToken(idToken);
  const session: XaiOAuthSession = {
    accessToken: o.access_token,
    refreshToken: refresh,
    expiresAt: now + expiresIn * 1000,
  };
  if (idToken) session.idToken = idToken;
  const email = fromId.email ?? previous?.email;
  const name = fromId.name ?? previous?.name;
  if (email) session.email = email;
  if (name) session.name = name;
  return session;
}

function oauthErrorCode(body: unknown): string | undefined {
  const o = asRecord(body);
  return o && isNonEmptyString(o.error) ? o.error : undefined;
}

function pickVerificationUrl(body: Record<string, unknown>): string {
  if (
    isNonEmptyString(body.verification_uri_complete) &&
    body.verification_uri_complete.startsWith("https://")
  ) {
    return body.verification_uri_complete;
  }
  if (
    isNonEmptyString(body.verification_uri) &&
    body.verification_uri.startsWith("https://")
  ) {
    return body.verification_uri;
  }
  throw new Error("xAI did not return a verification URL.");
}

export async function requestXaiDeviceCode(
  signal?: AbortSignal,
): Promise<XaiDeviceCode> {
  throwIfAborted(signal);
  const { status, body } = await postForm(
    DEVICE_URL,
    {
      client_id: XAI_OAUTH_CLIENT_ID,
      scope: XAI_OAUTH_SCOPE,
    },
    signal,
  );
  const o = asRecord(body);
  if (status < 200 || status >= 300 || !o) {
    throw new Error(oauthErrorMessage(body, "Failed to start xAI sign-in."));
  }
  if (!isNonEmptyString(o.device_code) || !isNonEmptyString(o.user_code)) {
    throw new Error("xAI did not return a device code.");
  }
  const expiresRaw =
    typeof o.expires_in === "number" ? o.expires_in : Number(o.expires_in);
  const expiresIn =
    Number.isFinite(expiresRaw) && expiresRaw > 0
      ? expiresRaw
      : DEFAULT_EXPIRES_IN_SEC;
  const intervalRaw =
    typeof o.interval === "number" ? o.interval : Number(o.interval);
  const intervalSec =
    Number.isFinite(intervalRaw) && intervalRaw > 0
      ? intervalRaw
      : DEFAULT_INTERVAL_SEC;
  return {
    deviceCode: o.device_code,
    userCode: o.user_code,
    verificationUrl: pickVerificationUrl(o),
    expiresAt: Date.now() + expiresIn * 1000,
    intervalMs: Math.max(DEFAULT_INTERVAL_SEC, intervalSec) * 1000,
  };
}

export async function pollXaiDeviceToken(
  device: XaiDeviceCode,
  signal?: AbortSignal,
): Promise<XaiOAuthSession> {
  let intervalMs = device.intervalMs;
  while (true) {
    throwIfAborted(signal);
    if (Date.now() >= device.expiresAt) {
      throw new Error("The sign-in code expired. Start again.");
    }
    await sleep(intervalMs, signal);
    throwIfAborted(signal);
    const { status, body } = await postForm(
      TOKEN_URL,
      {
        grant_type: DEVICE_GRANT,
        device_code: device.deviceCode,
        client_id: XAI_OAUTH_CLIENT_ID,
      },
      signal,
    );
    const code = oauthErrorCode(body);
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (code === "expired_token") {
      throw new Error("The sign-in code expired. Start again.");
    }
    if (code === "access_denied") {
      throw new Error("Sign-in was denied.");
    }
    if (code) {
      throw new Error(oauthErrorMessage(body, "xAI sign-in failed."));
    }
    if (status < 200 || status >= 300) {
      throw new Error(oauthErrorMessage(body, "xAI sign-in failed."));
    }
    const session = credentialsFromTokenResponse(body);
    if (!session) {
      throw new Error("xAI did not return an access token.");
    }
    return session;
  }
}

async function enrichIdentity(
  session: XaiOAuthSession,
  signal?: AbortSignal,
): Promise<XaiOAuthSession> {
  if (session.email && session.name) return session;
  try {
    throwIfAborted(signal);
    const res = await proxyFetch(USERINFO_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
      signal,
    });
    if (!res.ok) return session;
    const o = asRecord(await readJson(res));
    if (!o) return session;
    const email = isNonEmptyString(o.email) ? o.email : session.email;
    const name = isNonEmptyString(o.name)
      ? o.name
      : isNonEmptyString(o.preferred_username)
        ? o.preferred_username
        : session.name;
    return {
      ...session,
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof Error && e.name === "AbortError") throw e;
    return session;
  }
}

export async function readXaiOAuthSession(): Promise<XaiOAuthSession | null> {
  const raw = await secretGet(XAI_OAUTH_ACCOUNT);
  if (!raw) return null;
  const combined = parseOAuthSession(raw);
  if (combined) return combined;
  let meta: unknown;
  try {
    meta = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = asRecord(meta);
  if (!o) return null;
  const accessParts = Number(o.accessParts);
  const refreshParts = Number(o.refreshParts);
  const partAccounts = oauthPartAccounts(
    XAI_OAUTH_ACCESS_PREFIX,
    accessParts,
    XAI_OAUTH_REFRESH_PREFIX,
    refreshParts,
  );
  if (partAccounts.length === 0) return null;
  const map: Record<string, string | null> = { [XAI_OAUTH_ACCOUNT]: raw };
  try {
    const results = await invoke<(string | null)[]>("secrets_get_all", {
      service: KEYRING_SERVICE,
      accounts: partAccounts,
    });
    partAccounts.forEach((account, i) => {
      map[account] = results[i] ?? null;
    });
  } catch {
    for (const account of partAccounts) {
      map[account] = await secretGet(account);
    }
  }
  return sessionFromCredentialMap(map);
}

export async function writeXaiOAuthSession(
  session: XaiOAuthSession,
): Promise<void> {
  const entries = sessionToCredentialEntries(session);
  for (const entry of entries) {
    await secretSet(entry.account, entry.password);
  }
  const written = new Set(entries.map((e) => e.account));
  for (let i = 0; i < MAX_STORED_PARTS; i++) {
    const access = partAccount(XAI_OAUTH_ACCESS_PREFIX, i);
    const refresh = partAccount(XAI_OAUTH_REFRESH_PREFIX, i);
    if (!written.has(access)) await secretDelete(access);
    if (!written.has(refresh)) await secretDelete(refresh);
  }
}

async function revokeToken(token: string): Promise<void> {
  await postForm(REVOKE_URL, {
    token,
    client_id: XAI_OAUTH_CLIENT_ID,
    token_type_hint: "refresh_token",
  });
}

export async function clearXaiOAuthSession(): Promise<void> {
  const session = await readXaiOAuthSession();
  if (session) {
    try {
      await revokeToken(session.refreshToken || session.accessToken);
    } catch {
      // best-effort
    }
  }
  await secretDelete(XAI_OAUTH_ACCOUNT);
  for (let i = 0; i < MAX_STORED_PARTS; i++) {
    await secretDelete(partAccount(XAI_OAUTH_ACCESS_PREFIX, i));
    await secretDelete(partAccount(XAI_OAUTH_REFRESH_PREFIX, i));
  }
}

export async function completeXaiOAuthLogin(opts?: {
  signal?: AbortSignal;
  onDeviceCode?: (device: XaiDeviceCode) => void;
}): Promise<XaiOAuthSession> {
  const device = await requestXaiDeviceCode(opts?.signal);
  opts?.onDeviceCode?.(device);
  const session = await pollXaiDeviceToken(device, opts?.signal);
  const withIdentity = await enrichIdentity(session, opts?.signal);
  await writeXaiOAuthSession(withIdentity);
  return withIdentity;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshSession(
  session: XaiOAuthSession,
): Promise<string | null> {
  try {
    const { status, body } = await postForm(TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: XAI_OAUTH_CLIENT_ID,
    });
    if (status < 200 || status >= 300) {
      throw new Error(oauthErrorMessage(body, "xAI token refresh failed."));
    }
    const next = credentialsFromTokenResponse(body, session);
    if (!next) throw new Error("xAI token refresh failed.");
    await writeXaiOAuthSession({
      ...session,
      ...next,
      email: next.email ?? session.email,
      name: next.name ?? session.name,
    });
    return next.accessToken;
  } catch {
    if (session.expiresAt > Date.now()) return session.accessToken;
    return null;
  }
}

export async function resolveXaiOAuthAccessToken(): Promise<string | null> {
  const session = await readXaiOAuthSession();
  if (!session) return null;
  if (!sessionNeedsRefresh(session)) return session.accessToken;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshSession(session).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
