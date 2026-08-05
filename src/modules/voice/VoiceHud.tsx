import { useVoiceStore } from "./voiceStore";

const WRAP_CLASS =
  "pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2";
const PILL_CLASS =
  "flex items-center gap-2.5 rounded-full border border-white/10 bg-black/80 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-md";

export function VoiceHud() {
  const status = useVoiceStore((s) => s.status);

  if (status === "idle") return null;

  const recording = status === "recording";

  return (
    <div className={WRAP_CLASS} role="status" aria-live="polite">
      <div className={PILL_CLASS}>
        {recording ? (
          <>
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span>Listening…</span>
          </>
        ) : (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span>Transcribing…</span>
          </>
        )}
      </div>
    </div>
  );
}
