import { invoke } from "@tauri-apps/api/core";
import { openPty } from "@/modules/terminal/lib/pty-bridge";
import type { Driver } from "./scenarios";

const realFetch = window.fetch.bind(window);
const invokes = new Map<string, number>();
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : String(input);
  const match = /^(?:ipc:\/\/localhost|http:\/\/ipc\.localhost)\/(.+)$/.exec(url);
  if (match) {
    const command = decodeURIComponent(match[1]);
    invokes.set(command, (invokes.get(command) ?? 0) + 1);
  }
  return realFetch(input, init);
}) as typeof window.fetch;

const count = (command: string) => invokes.get(command) ?? 0;

export const driver: Driver = {
  name: "per-terminal channels (previous transport)",
  openPty,
  // Each channel message is one delivery (webview.eval, plus a fetch invoke
  // for payloads over 1 KiB), each acknowledgement one synchronous invoke.
  streamOps: (deliveries) =>
    deliveries +
    count("pty_ack_output") +
    count("plugin:__TAURI_CHANNEL__|fetch"),
  breakdown: () => ({
    ackInvokes: count("pty_ack_output"),
    channelFetches: count("plugin:__TAURI_CHANNEL__|fetch"),
  }),
  native: () => invoke("pty_diagnostics"),
  jsHub: () => null,
  realFetch,
};
