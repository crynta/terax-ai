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
  useEffect(() => {
    resolveRef.current = resolveTarget;
  });

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

  const bindImpl = useVoiceStore((s) => s.bindImpl);
  const setStatus = useVoiceStore((s) => s.setStatus);

  const { start, stop, cancel, state, supported, hasKey } = voice;

  useEffect(() => {
    setStatus(state);
  }, [state, setStatus]);

  useEffect(() => {
    bindImpl({
      start: () => void start(),
      stop,
      cancel,
      supported,
      hasKey,
    });
  }, [bindImpl, start, stop, cancel, supported, hasKey]);

  return voice;
}
