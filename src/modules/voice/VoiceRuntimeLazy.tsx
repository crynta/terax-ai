import { lazy, Suspense } from "react";
import type { VoiceRuntimeProps } from "./VoiceRuntime";
import { useVoiceStore } from "./voiceStore";

const VoiceRuntimeInner = lazy(() =>
  import("./VoiceRuntime").then((m) => ({ default: m.VoiceRuntime })),
);

export function VoiceRuntime(props: VoiceRuntimeProps) {
  const armed = useVoiceStore((s) => s.armed);
  if (!armed) return null;
  return (
    <Suspense fallback={null}>
      <VoiceRuntimeInner {...props} />
    </Suspense>
  );
}
