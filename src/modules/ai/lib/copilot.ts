import { invoke } from "@tauri-apps/api/core";
import { COPILOT_BASE_URL } from "../config";

// ── Types matching Rust backend ─────────────────────────────────────────

export type DeviceFlowStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
};

export type CopilotTokenInfo = {
  token: string;
  expiresAt: number;
};

export type CopilotModel = {
  id: string;
  name: string;
};

type CopilotAuthMap = Record<string, string>;

// ── OAuth Device Flow (via Rust backend) ────────────────────────────────

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  return invoke<DeviceFlowStart>("copilot_start_device_flow");
}

export async function pollAccessToken(
  deviceCode: string,
): Promise<string | null> {
  return invoke<string | null>("copilot_poll_token", { deviceCode });
}

export async function exchangeCopilotToken(
  ghoToken: string,
): Promise<CopilotTokenInfo> {
  return invoke<CopilotTokenInfo>("copilot_exchange_token", {
    ghoToken,
  });
}

export async function persistCopilotAuth(
  ghoToken: string,
  copilotToken: string,
  expiresAt: number,
): Promise<void> {
  return invoke("copilot_persist_auth", {
    ghoToken,
    copilotToken,
    expiresAt,
  });
}

export async function clearCopilotAuth(): Promise<void> {
  return invoke("copilot_clear_auth");
}

export async function getCopilotAuth(): Promise<CopilotAuthMap> {
  return invoke<CopilotAuthMap>("copilot_get_auth");
}

export async function ensureCopilotToken(): Promise<string | null> {
  const token = await invoke<string>("copilot_ensure_token");
  return token.length > 0 ? token : null;
}

export async function isCopilotAuthenticated(): Promise<boolean> {
  const token = await ensureCopilotToken();
  return token !== null;
}

export async function fetchCopilotModels(): Promise<CopilotModel[]> {
  const token = await ensureCopilotToken();
  if (!token) return [];
  return invoke<CopilotModel[]>("copilot_fetch_models", {
    copilotToken: token,
  });
}

// ── Custom fetch for the AI SDK ────────────────────────────────────────

export function createCopilotFetch(): typeof fetch {
  return async function copilotFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    // AI SDK appends /v1/chat/completions and /v1/models.
    // Copilot uses /chat/completions and /models (no /v1/ prefix).
    const rewritten = url
      .replace(`${COPILOT_BASE_URL}/v1/chat/completions`, `${COPILOT_BASE_URL}/chat/completions`)
      .replace(`${COPILOT_BASE_URL}/v1/models`, `${COPILOT_BASE_URL}/models`);

    const token = await ensureCopilotToken();

    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
    headers.set("editor-version", "vscode/1.85.0");
    headers.set("user-agent", "GithubCopilot/1.155.0");
    headers.set("Copilot-Integration-Id", "vscode-chat");

    return fetch(rewritten, { ...init, headers });
  };
}
