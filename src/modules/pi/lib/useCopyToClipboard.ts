import { useCallback, useEffect, useRef, useState } from "react";

export type CopyStatus = "copied" | "failed" | "idle";

export function copyStatusLabel(status: CopyStatus, idleLabel = ""): string {
  switch (status) {
    case "copied":
      return "Copied";
    case "failed":
      return "Copy failed";
    case "idle":
      return idleLabel;
  }
}

export function useCopyToClipboard(resetDelayMs = 1600) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetStatusSoon = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => setStatus("idle"), resetDelayMs);
  }, [resetDelayMs]);

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copyText = useCallback(
    async (text: string) => {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        setStatus("failed");
        resetStatusSoon();
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setStatus("copied");
      } catch {
        setStatus("failed");
      }
      resetStatusSoon();
    },
    [resetStatusSoon],
  );

  return { copyText, status };
}
