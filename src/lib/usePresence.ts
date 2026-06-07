import { useEffect, useRef, useState } from "react";

export type PresenceState = "open" | "closed";

/**
 * Keeps a node mounted for one exit-animation duration after `open` flips to
 * false, so CSS keyframes keyed on `data-state` can animate it out before it
 * unmounts. Replaces motion's `AnimatePresence` for single-node transitions.
 * `exitMs` must match the closed-state animation duration.
 */
export function usePresence(open: boolean, exitMs = 150) {
  const [mounted, setMounted] = useState(open);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (open) {
      setMounted(true);
    } else if (mounted) {
      timer.current = setTimeout(() => setMounted(false), exitMs);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, exitMs, mounted]);

  return { mounted, state: (open ? "open" : "closed") as PresenceState };
}
