import { invoke } from "@tauri-apps/api/core";
import type {
  PiSessionCreateResult,
  PiSessionSendResult,
  PiSessionStopResult,
  PiSessionsList,
} from "./sessions";
import type { PiDiagnostics, PiHostInfo, PiRuntimeState } from "./status";

export const piNative = {
  status: () => invoke<PiRuntimeState>("pi_status"),
  start: () => invoke<PiRuntimeState>("pi_start"),
  stop: () => invoke<PiRuntimeState>("pi_stop"),
  hostInfo: () => invoke<PiHostInfo>("pi_host_info"),
  diagnostics: () => invoke<PiDiagnostics>("pi_diagnostics"),
  sessionsHistory: () => invoke<PiSessionsList>("pi_sessions_history"),
  sessionsList: () => invoke<PiSessionsList>("pi_sessions_list"),
  sessionCreate: (title?: string) =>
    invoke<PiSessionCreateResult>("pi_session_create", {
      title: title ?? null,
    }),
  sessionSend: (sessionId: string, prompt: string) =>
    invoke<PiSessionSendResult>("pi_session_send", { sessionId, prompt }),
  sessionStop: (sessionId: string) =>
    invoke<PiSessionStopResult>("pi_session_stop", { sessionId }),
};
