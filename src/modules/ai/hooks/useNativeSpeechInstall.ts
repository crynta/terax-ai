import type { NativeSpeechProfile } from "@/modules/ai/config";
import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type NativeSpeechStatus = {
  supported: boolean;
  runtimeInstalled: boolean;
  runtimeSource: string | null;
  nemotronInstalled: boolean;
  parakeetInstalled: boolean;
};

type NativeSpeechInstallEvent =
  | { kind: "phase"; label: string }
  | { kind: "progress"; downloaded: number; total: number }
  | { kind: "complete" };

export type NativeSpeechInstallProgress = {
  downloaded: number;
  total: number;
};

export function useNativeSpeechInstall(
  enabled: boolean,
  profile: NativeSpeechProfile,
) {
  const [status, setStatus] = useState<NativeSpeechStatus | null>(null);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState<NativeSpeechInstallProgress | null>(
    null,
  );
  const mounted = useRef(true);
  const operation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const id = ++operation.current;
    if (!enabled) {
      setInstalling(false);
      return;
    }
    setStatus(null);
    setError("");
    invoke<NativeSpeechStatus>("stt_native_status")
      .then((nextStatus) => {
        if (mounted.current && operation.current === id) {
          setStatus(nextStatus);
        }
      })
      .catch((nextError) => {
        if (mounted.current && operation.current === id) {
          setError(
            typeof nextError === "string"
              ? nextError
              : "Could not inspect the native speech runtime.",
          );
        }
      });
  }, [enabled]);

  const clearFeedback = useCallback(() => {
    setError("");
    setPhase("");
    setProgress(null);
  }, []);

  const install = useCallback(async () => {
    const id = ++operation.current;
    setInstalling(true);
    setError("");
    setPhase("Preparing download");
    setProgress(null);
    const channel = new Channel<NativeSpeechInstallEvent>();
    channel.onmessage = (event) => {
      if (!mounted.current || operation.current !== id) return;
      if (event.kind === "phase") {
        setPhase(event.label);
        setProgress(null);
      } else if (event.kind === "progress") {
        setProgress({
          downloaded: event.downloaded,
          total: event.total,
        });
      }
    };
    try {
      const nextStatus = await invoke<NativeSpeechStatus>(
        "stt_native_install",
        {
          profile,
          onEvent: channel,
        },
      );
      if (mounted.current && operation.current === id) {
        setStatus(nextStatus);
        setPhase("");
        setProgress(null);
      }
    } catch (nextError) {
      if (mounted.current && operation.current === id) {
        setError(
          typeof nextError === "string"
            ? nextError
            : "Native speech installation failed.",
        );
      }
    } finally {
      if (mounted.current && operation.current === id) {
        setInstalling(false);
      }
    }
  }, [profile]);

  return {
    status,
    error,
    installing,
    phase,
    progress,
    clearFeedback,
    install,
  };
}
