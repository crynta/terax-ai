import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useState } from "react";

const LAST_CHECK_KEY = "terax:updater:last-check";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; downloaded: number; contentLength: number | null }
  | { kind: "ready" }
  | { kind: "error"; message: string };

interface Options {
  /** Skip the time-based throttle on automatic startup checks. */
  manual?: boolean;
}

interface HookOptions {
  /** When false, the hook does not run an automatic check on mount. */
  autoCheck?: boolean;
}

export function useUpdater({ autoCheck = true }: HookOptions = {}) {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });

  const runCheck = useCallback(async ({ manual }: Options = {}) => {
    if (!manual) {
      const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
      if (Date.now() - last < CHECK_INTERVAL_MS) return;
    }
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      if (update) {
        setStatus({ kind: "available", update });
      } else {
        setStatus({ kind: "uptodate" });
      }
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, []);

  const install = useCallback(async () => {
    if (status.kind !== "available") return;
    const { update } = status;
    let total: number | null = null;
    let downloaded = 0;
    setStatus({ kind: "downloading", downloaded: 0, contentLength: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setStatus({ kind: "downloading", downloaded: 0, contentLength: total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setStatus({ kind: "downloading", downloaded, contentLength: total });
        } else if (event.event === "Finished") {
          setStatus({ kind: "ready" });
        }
      });
      await relaunch();
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  }, [status]);

  const dismiss = useCallback(() => {
    setStatus({ kind: "idle" });
  }, []);

  useEffect(() => {
    if (!autoCheck) return;
    void runCheck();
  }, [autoCheck, runCheck]);

  return { status, check: runCheck, install, dismiss };
}
