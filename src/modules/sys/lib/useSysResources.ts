import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/** Mirrors the `SysResources` struct returned by the `sys_resources` command. */
export type SysResources = {
  cpu_percent: number;
  mem_total_bytes: number;
  mem_used_bytes: number;
  model_process: string | null;
  model_mem_bytes: number | null;
};

const POLL_MS = 3000;

/**
 * Polls system CPU/RAM usage every few seconds. Best-effort: returns `null`
 * until the first successful read (e.g. if the backend command is unavailable).
 */
export function useSysResources(): SysResources | null {
  const [resources, setResources] = useState<SysResources | null>(null);

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      void invoke<SysResources>("sys_resources")
        .then((value) => {
          if (!cancelled) setResources(value);
        })
        .catch(() => {
          // Backend not ready or unsupported platform; keep last value.
        });
    };

    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return resources;
}
