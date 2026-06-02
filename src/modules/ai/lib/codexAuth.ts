import { invoke } from "@tauri-apps/api/core";

export type CodexAuthStatus = {
  signedIn: boolean;
  needsRelogin: boolean;
  rateLimitedUntilMs?: number | null;
  accountEmail?: string | null;
  planType?: string | null;
  expiresAtMs?: number | null;
  lastRefreshMs?: number | null;
  message?: string | null;
};

export type CodexDeviceStart = {
  loginId: string;
  verificationUrl: string;
  userCode: string;
  expiresAtMs: number;
  pollIntervalSecs: number;
};

export type CodexPollResult = {
  status: "pending" | "complete" | "expired" | "error";
  auth?: CodexAuthStatus | null;
  message?: string | null;
};

export const CODEX_DISCONNECTED_STATUS: CodexAuthStatus = {
  signedIn: false,
  needsRelogin: false,
  rateLimitedUntilMs: null,
  accountEmail: null,
  planType: null,
  expiresAtMs: null,
  lastRefreshMs: null,
  message: null,
};

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  return invoke<CodexAuthStatus>("openai_codex_auth_status");
}

export async function startCodexDeviceLogin(): Promise<CodexDeviceStart> {
  return invoke<CodexDeviceStart>("openai_codex_auth_start_device");
}

export async function pollCodexDeviceLogin(
  loginId: string,
): Promise<CodexPollResult> {
  return invoke<CodexPollResult>("openai_codex_auth_poll", { loginId });
}

export async function cancelCodexDeviceLogin(loginId: string): Promise<void> {
  await invoke("openai_codex_auth_cancel", { loginId });
}

export async function logoutCodex(): Promise<void> {
  await invoke("openai_codex_auth_logout");
}
