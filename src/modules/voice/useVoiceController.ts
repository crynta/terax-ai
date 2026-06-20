import { useCallback, useEffect, useRef } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useWhisperRecording } from "@/modules/ai/hooks/useWhisperRecording";
import { useVoiceStore } from "./voiceStore";
import { cleanupTranscript } from "./cleanup";

export function useVoiceController({
  resolveTarget,
}: {
  resolveTarget: () => (text: string) => void;
}) {
  const resolveRef = useRef(resolveTarget);
  resolveRef.current = resolveTarget;

  const onResult = useCallback(async (raw: string) => {
    const apply = resolveRef.current();
    let text = raw;
    if (usePreferencesStore.getState().voiceCleanupEnabled) {
      try {
        text = await cleanupTranscript(raw);
      } catch {
        text = raw;
      }
    }
    if (text.trim()) apply(text.trim());
  }, []);

  const voice = useWhisperRecording({ onResult });

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const bindImpl = useVoiceStore((s) => s.bindImpl);
  const setStatus = useVoiceStore((s) => s.setStatus);

  useEffect(() => {
    setStatus(voice.state);
  }, [voice.state, setStatus]);

  useEffect(() => {
    bindImpl({
      start: () => void voiceRef.current.start(),
      stop: () => voiceRef.current.stop(),
      supported: voice.supported,
      hasKey: voice.hasKey,
    });
  }, [bindImpl, voice.supported, voice.hasKey]);

  return voice;
}
