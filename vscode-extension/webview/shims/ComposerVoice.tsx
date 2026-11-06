/**
 * VS Code webviews can't use the microphone or Terax's native speech
 * engine, so the mic explains how to dictate instead. The button itself is
 * Terax's own.
 */
import { useState } from "react";

export { MicButton, type VoiceState } from "@/modules/agents/reader/ComposerVoice";

const DICTATION_HINT =
  "Voice input can't run inside VS Code. Press Fn twice (macOS Dictation) and speak — the words go straight into this box.";

export function useVoiceInput({
  focusComposer,
  onProblem,
}: {
  onStart?: () => void;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  focusComposer: () => void;
  onProblem: (message: string) => void;
}) {
  const [lang, setLang] = useState("en-IN");
  return {
    state: "idle" as const,
    toggle: () => {
      focusComposer();
      onProblem(DICTATION_HINT);
    },
    stop: () => {},
    lang,
    setLang,
  };
}
