import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

type PttState = "idle" | "recording";

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
    if (!enabled) return;

    let cancelled = false;
    (async () => {
      try {
        await invoke("ptt_register", { shortcut });
      } catch (e) {
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
        return;
      }

      unlistenRef.current = () => {
        unlistenStart();
        unlistenStop();
        // Unregister the SAME shortcut that was registered for this effect run.
        invoke("ptt_unregister", { shortcut }).catch(() => {});
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
