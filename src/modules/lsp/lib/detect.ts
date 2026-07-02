import { invoke } from "@tauri-apps/api/core";
import { useLspRuntimeStore } from "./runtimeStore";

const pending = new Map<string, Promise<string | null>>();

export function detectBinary(command: string): Promise<string | null> {
  const cached = useLspRuntimeStore.getState().detected[command];
  if (cached !== undefined) return Promise.resolve(cached);
  let p = pending.get(command);
  if (!p) {
    p = invoke<string | null>("lsp_detect", { command })
      .catch(() => null)
      .then((path) => {
        pending.delete(command);
        useLspRuntimeStore.getState().setDetected(command, path);
        return path;
      });
    pending.set(command, p);
  }
  return p;
}

export function redetectBinary(command: string): Promise<string | null> {
  pending.delete(command);
  useLspRuntimeStore.getState().clearDetected(command);
  return detectBinary(command);
}
