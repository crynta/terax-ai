import { lazy, Suspense, useEffect, useState } from "react";
import {
  setTerminalLinkHoverListener,
  type TerminalLinkHoverEvent,
} from "@/modules/terminal/lib/terminalFileLinks";

const TerminalLinkChipInner = lazy(() => import("./TerminalLinkChip"));

/**
 * Listens for terminal link hovers and mounts the floating link chip on the
 * first one, so its code never loads for sessions that don't hover a link.
 */
export function TerminalLinkChip() {
  const [hover, setHover] = useState<TerminalLinkHoverEvent | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setTerminalLinkHoverListener((event) => {
      setHover(event);
      if (event) setArmed(true);
    });
    return () => setTerminalLinkHoverListener(null);
  }, []);
  if (!armed) return null;
  return (
    <Suspense fallback={null}>
      <TerminalLinkChipInner hover={hover} />
    </Suspense>
  );
}
