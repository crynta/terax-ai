import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVoiceStore } from "./voiceStore";

const WRAP_CLASS = "fixed bottom-11 left-1/2 z-40 -translate-x-1/2";
const PILL_CLASS =
  "flex items-center gap-1 rounded-full border border-white/10 bg-black/80 py-1 pl-1.5 pr-1 text-sm font-medium text-white shadow-lg backdrop-blur-md";
const ACTION_CLASS =
  "flex items-center gap-2.5 rounded-full px-2.5 py-1 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 disabled:hover:bg-transparent";
const CANCEL_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40";

export function VoiceHud() {
  const status = useVoiceStore((s) => s.status);
  const requestStop = useVoiceStore((s) => s.requestStop);
  const requestCancel = useVoiceStore((s) => s.requestCancel);

  if (status === "idle") return null;

  const recording = status === "recording";
  const arming = status === "arming";

  return (
    <div className={WRAP_CLASS}>
      <div className={PILL_CLASS} role="status" aria-live="polite">
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={requestStop}
          disabled={!recording}
          aria-label={recording ? "Stop recording and transcribe" : undefined}
        >
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
              <span>{arming ? "Starting…" : "Transcribing…"}</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={CANCEL_CLASS}
          onClick={requestCancel}
          aria-label="Cancel recording and discard audio"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
