/**
 * Thin wrappers around the Tauri commands exposed by the Rust agents module.
 *
 * Keeping these isolated from the transport / store code means refactors of
 * the wire format land in one place. The Channel<AgentEvent> handshake is
 * replicated here so callers don't need to know which Tauri import does
 * which thing.
 */

import { Channel, invoke } from "@tauri-apps/api/core";

import type { AgentEvent, BackendStatus } from "./types";

type RawAuthEnv = {
  account: string;
  env_name: string;
  label: string;
  hint: string;
};

type RawBackendStatus = {
  id: string;
  label: string;
  kind: string;
  binary_path: string | null;
  install_hint: string;
  auth_hint: string;
  docs_url: string;
  auth_envs: RawAuthEnv[];
};

export async function listBackends(): Promise<BackendStatus[]> {
  const raw = await invoke<RawBackendStatus[]>("agent_backends_list");
  return raw.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    binaryPath: r.binary_path,
    installHint: r.install_hint,
    authHint: r.auth_hint,
    docsUrl: r.docs_url,
    authEnvs: (r.auth_envs ?? []).map((e) => ({
      account: e.account,
      envName: e.env_name,
      label: e.label,
      hint: e.hint,
    })),
  }));
}

/**
 * Read/write/delete a value in the Terax keychain under a backend's
 * specified auth-env account. The Settings UI uses these for the
 * inline API-key / OAuth-token fields on each backend row.
 */
const KEYRING_SERVICE = "terax-ai";

export async function readAuthEnvValue(
  account: string,
): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function writeAuthEnvValue(
  account: string,
  value: string,
): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("value is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account,
    password: trimmed,
  });
}

export async function clearAuthEnvValue(account: string): Promise<void> {
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account,
    });
  } catch {
    /* already absent — fine */
  }
}

/**
 * Spawns the backend CLI and binds an event channel. The returned `sessionId`
 * is the *Terax* session id — it has nothing to do with ACP's internal
 * session id. The caller passes the same id to subsequent `prompt`/`cancel`/
 * `close` calls.
 *
 * `onEvent` is called for every `AgentEvent` the agent emits, in order.
 * Drop the returned `dispose()` to unsubscribe (it does NOT close the agent
 * process — call `closeSession` for that).
 */
export async function startSession(opts: {
  backendId: string;
  cwd: string | null;
  onEvent: (ev: AgentEvent) => void;
}): Promise<{ sessionId: string; dispose: () => void }> {
  const channel = new Channel<AgentEvent>();
  channel.onmessage = (ev) => {
    try {
      opts.onEvent(ev);
    } catch (e) {
      // Don't let a UI bug kill the channel. Log and drop.
      // eslint-disable-next-line no-console
      console.error("[agents-acp] onEvent threw:", e);
    }
  };

  const sessionId = await invoke<string>("agent_session_start", {
    args: {
      backend_id: opts.backendId,
      cwd: opts.cwd ?? null,
    },
    onEvent: channel,
  });

  return {
    sessionId,
    // Tauri's Channel doesn't expose a public unsubscribe; reset the handler
    // so further events are no-ops. The channel itself is GC-ed when no
    // refs remain.
    dispose: () => {
      channel.onmessage = () => {};
    },
  };
}

export function sendPrompt(sessionId: string, text: string): Promise<void> {
  return invoke<void>("agent_session_prompt", { sessionId, text });
}

export function cancelTurn(sessionId: string): Promise<void> {
  return invoke<void>("agent_session_cancel", { sessionId });
}

export function closeSession(sessionId: string): Promise<void> {
  return invoke<void>("agent_session_close", { sessionId });
}

export function respondToPermission(opts: {
  sessionId: string;
  requestId: string;
  optionId: string | null;
  cancelled: boolean;
}): Promise<void> {
  return invoke<void>("agent_permission_respond", {
    sessionId: opts.sessionId,
    requestId: opts.requestId,
    optionId: opts.optionId,
    cancelled: opts.cancelled,
  });
}

export type ProxyCheck = {
  var: string;
  value: string;
  reachable: boolean | null;
};

export type PromptCheck = {
  ok: boolean;
  stopReason: string | null;
  error: string | null;
};

export type TestResult = {
  ok: boolean;
  backendId: string;
  binaryPath: string | null;
  agentName: string | null;
  agentVersion: string | null;
  protocolVersion: number | null;
  sessionId: string | null;
  authMethods: string[];
  strippedEnv: string[];
  /** Env vars we successfully forwarded from the keychain. */
  forwardedAuth: string[];
  proxies: ProxyCheck[];
  prompt: PromptCheck | null;
  error: string | null;
  stderr: string | null;
  elapsedMs: number;
};

type RawProxyCheck = {
  var: string;
  value: string;
  reachable: boolean | null;
};

type RawPromptCheck = {
  ok: boolean;
  stop_reason: string | null;
  error: string | null;
};

type RawTestResult = {
  ok: boolean;
  backend_id: string;
  binary_path: string | null;
  agent_name: string | null;
  agent_version: string | null;
  protocol_version: number | null;
  session_id: string | null;
  auth_methods: string[];
  stripped_env: string[];
  forwarded_auth: string[];
  proxies: RawProxyCheck[];
  prompt: RawPromptCheck | null;
  error: string | null;
  stderr: string | null;
  elapsed_ms: number;
};

/**
 * Spawn the backend the same way a real chat session would, walk the ACP
 * handshake (initialize → session/new → optional real prompt), and return
 * a structured diagnostic. Used by the External Agents settings tab's
 * "Test connection" button.
 *
 * Pass `withPrompt: true` to also send a tiny real prompt — this exercises
 * the agent's actual API call (auth + network + proxy) and is the only
 * way to catch failures that surface only at chat time. Costs one cheap
 * API turn.
 */
export async function testBackend(
  backendId: string,
  cwd: string | null,
  withPrompt: boolean = false,
): Promise<TestResult> {
  const r = await invoke<RawTestResult>("agent_backend_test", {
    backendId,
    cwd: cwd ?? null,
    withPrompt,
  });
  return {
    ok: r.ok,
    backendId: r.backend_id,
    binaryPath: r.binary_path,
    agentName: r.agent_name,
    agentVersion: r.agent_version,
    protocolVersion: r.protocol_version,
    sessionId: r.session_id,
    authMethods: r.auth_methods,
    strippedEnv: r.stripped_env,
    forwardedAuth: r.forwarded_auth ?? [],
    proxies: r.proxies,
    prompt: r.prompt
      ? {
          ok: r.prompt.ok,
          stopReason: r.prompt.stop_reason,
          error: r.prompt.error,
        }
      : null,
    error: r.error,
    stderr: r.stderr,
    elapsedMs: r.elapsed_ms,
  };
}
