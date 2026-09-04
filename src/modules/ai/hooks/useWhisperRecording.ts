import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { transcribeAudio, type SttOptions } from "../lib/stt";
import type { SttProvider } from "../config";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

const ARMING_TIMEOUT_MS = 10_000;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function providerNeedsKey(provider: SttProvider): boolean {
  return provider !== "whispercpp";
}

function getApiKeyForStt(
  apiKeys: import("../lib/keyring").ProviderKeys,
  provider: SttProvider,
): string | null {
  if (provider === "openai") return apiKeys.openai;
  if (provider === "groq") return apiKeys.groq;
  return null;
}

type State = "idle" | "arming" | "recording" | "transcribing";

export function useWhisperRecording({
  onResult,
}: {
  onResult: (text: string) => void;
}) {
  const apiKeys = useChatStore((s) => s.apiKeys);
  const sttProvider = usePreferencesStore((s) => s.sttProvider);
  const groqSttModel = usePreferencesStore((s) => s.groqSttModel);
  const whispercppBaseURL = usePreferencesStore((s) => s.whispercppBaseURL);

  const [state, setState] = useState<State>("idle");
  const phaseRef = useRef<State>("idle");
  const runRef = useRef(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const armingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const needsKey = providerNeedsKey(sttProvider);
  const providerKey = needsKey ? getApiKeyForStt(apiKeys, sttProvider) : null;
  const hasKey = needsKey ? !!providerKey : true;

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const sttOptions: SttOptions = { groqSttModel, whispercppBaseURL };

  const latestRef = useRef({
    apiKeys,
    sttProvider,
    sttOptions,
    supported,
    hasKey,
    onResult,
  });
  useEffect(() => {
    latestRef.current = {
      apiKeys,
      sttProvider,
      sttOptions,
      supported,
      hasKey,
      onResult,
    };
  });

  const setPhase = useCallback((next: State) => {
    phaseRef.current = next;
    setState(next);
  }, []);

  const clearArmingTimer = useCallback(() => {
    if (armingTimerRef.current === null) return;
    clearTimeout(armingTimerRef.current);
    armingTimerRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const { supported: canRecord, hasKey: keyed } = latestRef.current;
    if (!canRecord || !keyed) return;
    if (phaseRef.current !== "idle") return;

    const run = (runRef.current += 1);
    setPhase("arming");

    clearArmingTimer();
    armingTimerRef.current = setTimeout(() => {
      armingTimerRef.current = null;
      if (runRef.current !== run) return;
      runRef.current += 1;
      releaseStream();
      setPhase("idle");
      toast.error("Microphone did not start in time");
    }, ARMING_TIMEOUT_MS);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      clearArmingTimer();
      console.error("stt.getUserMedia", e);
      if (runRef.current === run) {
        runRef.current += 1;
        releaseStream();
        setPhase("idle");
      }
      toast.error("Microphone access failed");
      return;
    }

    clearArmingTimer();

    if (runRef.current !== run) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    rec.onstop = async () => {
      const stale = runRef.current !== run;
      const blob = new Blob(chunksRef.current, {
        type: rec.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      recRef.current = null;
      releaseStream();

      if (stale || blob.size === 0) {
        if (!stale) setPhase("idle");
        return;
      }

      setPhase("transcribing");
      const { apiKeys: keys, sttProvider: provider, sttOptions: options } =
        latestRef.current;
      try {
        const text = await transcribeAudio(blob, provider, keys, options);
        if (runRef.current === run && text.trim()) {
          latestRef.current.onResult(text.trim());
        }
      } catch (e) {
        console.error("stt.transcribe", e);
        if (runRef.current === run) {
          toast.error(e instanceof Error ? e.message : "Transcription failed");
        }
      } finally {
        if (runRef.current === run) setPhase("idle");
      }
    };

    recRef.current = rec;
    rec.start();
    setPhase("recording");
  }, [clearArmingTimer, releaseStream, setPhase]);

  const stop = useCallback(() => {
    if (phaseRef.current === "arming") {
      runRef.current += 1;
      clearArmingTimer();
      releaseStream();
      setPhase("idle");
      return;
    }
    const rec = recRef.current;
    if (phaseRef.current === "recording" && rec && rec.state !== "inactive") {
      rec.stop();
    }
  }, [clearArmingTimer, releaseStream, setPhase]);

  const cancel = useCallback(() => {
    if (phaseRef.current === "idle") return;
    runRef.current += 1;
    clearArmingTimer();
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else releaseStream();
    setPhase("idle");
  }, [clearArmingTimer, releaseStream, setPhase]);

  useEffect(() => {
    return () => {
      runRef.current += 1;
      if (armingTimerRef.current !== null) clearTimeout(armingTimerRef.current);
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    start,
    stop,
    cancel,
    supported,
    hasKey,
    sttProvider,
  };
}
