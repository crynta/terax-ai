import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

type PttState = "idle" | "recording";

function pttErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error) ?? "";
  } catch {
    return "";
  }
}

function isUnavailablePttCommand(error: unknown): boolean {
  const message = pttErrorMessage(error).toLowerCase();
  return (
    message.includes("ptt_register") &&
    (message.includes("not found") ||
      message.includes("unknown command") ||
      message.includes("not registered"))
  );
}

function hasTauriInvokeBridge(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function usePushToTalk({
  onStart,
  onStop,
  enabled = true,
  shortcut = "Alt+Space",
}: {
  onStart: () => void;
  onStop: () => void;
  enabled?: boolean;
  /** Global shortcut to register, e.g. "Alt+Space". Honors the user setting. */
  shortcut?: string;
}) {
  const [state, setState] = useState<PttState>("idle");
  const unlistenRef = useRef<(() => void) | null>(null);
  const stateRef = useRef(state);
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);

  stateRef.current = state;
  onStartRef.current = onStart;
  onStopRef.current = onStop;

  const activate = useCallback(() => {
    if (!enabled || state !== "idle") return;
    setState("recording");
    onStartRef.current();
  }, [enabled, state]);

  const deactivate = useCallback(() => {
    if (state !== "recording") return;
    setState("idle");
    onStopRef.current();
  }, [state]);

  useEffect(() => {
    if (!enabled || !hasTauriInvokeBridge()) return;

    let cancelled = false;
    (async () => {
      let registered = false;
      try {
        await invoke("ptt_register", { shortcut });
        registered = true;
      } catch (e) {
        if (isUnavailablePttCommand(e)) return;
        console.warn("PTT register failed:", e);
      }

      const unlistenStart = await listen("voice-ptt-start", () => {
        if (!cancelled && stateRef.current === "idle") {
          setState("recording");
          onStartRef.current();
        }
      });
      const unlistenStop = await listen("voice-ptt-stop", () => {
        if (!cancelled && stateRef.current === "recording") {
          setState("idle");
          onStopRef.current();
        }
      });

      if (cancelled) {
        unlistenStart();
        unlistenStop();
        if (registered) {
          invoke("ptt_unregister", { shortcut }).catch(() => {});
        }
        return;
      }

      unlistenRef.current = () => {
        unlistenStart();
        unlistenStop();
        if (registered) {
          invoke("ptt_unregister", { shortcut }).catch(() => {});
        }
      };
    })();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [enabled, shortcut]);

  return { state, recording: state === "recording", activate, deactivate };
}
