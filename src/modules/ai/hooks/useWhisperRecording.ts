import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  createTranscriber,
  type Transcriber,
  type TranscriberState,
} from "../lib/transcribers";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

type RecordingState = "idle" | "recording" | "transcribing";

export function useWhisperRecording({
  onResult,
}: {
  onResult: (text: string) => void;
}) {
  const apiKey = useChatStore((s) => s.apiKeys.openai);
  const voiceProvider = usePreferencesStore((s) => s.voiceProvider);
  const localModel = usePreferencesStore((s) => s.localWhisperModel);
  const localLanguage = usePreferencesStore((s) => s.localWhisperLanguage);

  const [state, setState] = useState<RecordingState>("idle");
  const [transcriberState, setTranscriberState] = useState<TranscriberState>({
    kind: "idle",
  });

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriberRef = useRef<Transcriber | null>(null);

  // Recreate the transcriber whenever the selection changes.
  useEffect(() => {
    transcriberRef.current?.unload();
    const t = createTranscriber(
      voiceProvider === "local"
        ? { kind: "local", model: localModel, language: localLanguage }
        : { kind: "openai", apiKey: apiKey ?? null },
    );
    transcriberRef.current = t;
    const unsub = t.subscribe(setTranscriberState);
    return () => {
      unsub();
      t.unload();
      if (transcriberRef.current === t) transcriberRef.current = null;
    };
  }, [voiceProvider, localModel, localLanguage, apiKey]);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const teardownStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    const t = transcriberRef.current;
    if (!supported || !t || state !== "idle") return;
    if (!t.ready()) return;

    // Kick off model preload in parallel with capturing audio.
    t.preload();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        teardownStream();
        if (blob.size === 0) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const active = transcriberRef.current;
          if (!active) return;
          const text = await active.transcribe(blob);
          if (text.trim()) onResult(text.trim());
        } catch (e) {
          console.error("whisper.transcribe", e);
        } finally {
          setState("idle");
        }
      };
      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      console.error("whisper.getUserMedia", e);
      teardownStream();
      setState("idle");
    }
  }, [onResult, state, supported]);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
      teardownStream();
    };
  }, []);

  const provider = voiceProvider;
  const reasonUnavailable =
    transcriberRef.current?.unavailableReason() ?? null;

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    start,
    stop,
    supported,
    /** Backwards-compat alias used by current UI code paths. */
    hasKey: provider === "openai" ? !!apiKey : true,
    canRecord:
      supported &&
      (transcriberRef.current?.ready() ?? false),
    reasonUnavailable,
    /** The transcriber's own state (loading model / loaded / error). */
    transcriberState,
    provider,
    isLocalLoading:
      provider === "local" && transcriberState.kind === "loading",
  };
}
