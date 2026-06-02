import { invoke } from "@tauri-apps/api/core";
import type { PiHostInfo, PiRuntimeState } from "./status";

export const piNative = {
  status: () => invoke<PiRuntimeState>("pi_status"),
  start: () => invoke<PiRuntimeState>("pi_start"),
  stop: () => invoke<PiRuntimeState>("pi_stop"),
  hostInfo: () => invoke<PiHostInfo>("pi_host_info"),
};
