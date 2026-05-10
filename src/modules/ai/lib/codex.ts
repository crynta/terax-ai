import { invoke } from "@tauri-apps/api/core";

export type CodexAccountState = {
  authMode: string | null;
  email: string | null;
  planType: string | null;
  requiresOpenaiAuth: boolean;
};

export type CodexLoginStart = {
  type: string;
  loginId: string | null;
  authUrl: string | null;
  verificationUrl: string | null;
  userCode: string | null;
};

export function getCodexAccount(refreshToken = false) {
  return invoke<CodexAccountState>("codex_account_read", {
    refreshToken,
  });
}

export function startCodexLogin(deviceCode = false) {
  return invoke<CodexLoginStart>("codex_login_start", {
    deviceCode,
  });
}

export function logoutCodex() {
  return invoke<void>("codex_logout");
}

export function codexChatOnce(options: {
  prompt: string;
  cwd?: string | null;
  model?: string | null;
}) {
  return invoke<string>("codex_chat_once", {
    prompt: options.prompt,
    cwd: options.cwd ?? null,
    model: options.model ?? null,
  });
}
