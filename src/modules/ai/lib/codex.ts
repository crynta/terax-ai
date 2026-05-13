import { Channel, invoke } from "@tauri-apps/api/core";

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

export type CodexStreamEvent =
  | { kind: "agentMessageStart"; itemId: string }
  | { kind: "agentMessageDelta"; itemId: string; delta: string }
  | { kind: "agentMessageEnd"; itemId: string }
  | { kind: "reasoningStart"; itemId: string }
  | { kind: "reasoningDelta"; itemId: string; delta: string }
  | { kind: "reasoningEnd"; itemId: string }
  | { kind: "end" }
  | { kind: "error"; message: string };

export function codexChatStream(
  options: {
    prompt: string;
    cwd?: string | null;
    model?: string | null;
  },
  onEvent: (event: CodexStreamEvent) => void,
) {
  const channel = new Channel<CodexStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("codex_chat_stream", {
    prompt: options.prompt,
    cwd: options.cwd ?? null,
    model: options.model ?? null,
    onEvent: channel,
  });
}
