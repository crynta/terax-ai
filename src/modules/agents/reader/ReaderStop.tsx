import { cn } from "@/lib/utils";
import { StopIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { stopLabel } from "./lib/stopControl";
import { pressStopFor, tickStopFor, useStopState } from "./lib/stopStore";

const TICK_MS = 250;

/** Keeps `leafId`'s Stop state moving (Stopping → Force stop / Stopped → idle). Mount once per pane. */
export function useStopTicker(leafId: number, working: boolean): void {
  const state = useStopState(leafId);
  const active = state.kind !== "idle";
  useEffect(() => {
    tickStopFor(leafId, working);
    if (!active) return;
    const timer = setInterval(() => tickStopFor(leafId, working), TICK_MS);
    return () => clearInterval(timer);
  }, [leafId, working, active]);
}

/**
 * "Stop" while Claude works: sends Esc once; after 1.5 s of still working it
 * becomes "Force stop" (a second Esc). Shows "Stopping…" and "Stopped".
 */
export function StopButton({
  leafId,
  working,
  size = "md",
  className,
}: {
  leafId: number;
  working: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const state = useStopState(leafId);
  if (!working && state.kind === "idle") return null;
  const stopped = state.kind === "stopped";
  const force = state.kind === "force";
  return (
    <button
      type="button"
      onClick={() => pressStopFor(leafId)}
      disabled={state.kind === "stopping" || stopped}
      aria-label={force ? "Force stop Claude" : "Stop Claude"}
      title={
        force ? "Claude is still working: send Esc again" : "Stop (Esc · ⌘.)"
      }
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-xl border font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--terminal-ansi-red)]/50 disabled:cursor-default",
        size === "md" ? "h-8 px-2.5 text-[12px]" : "h-6 px-2 text-[11px]",
        stopped
          ? "border-[color-mix(in_oklab,var(--agent-done)_40%,transparent)] text-agent-done"
          : force
            ? "border-[var(--terminal-ansi-red)] bg-[color-mix(in_oklab,var(--terminal-ansi-red)_22%,var(--card))] text-[var(--terminal-ansi-red)]"
            : "border-border/70 bg-card text-foreground/85 hover:border-[color-mix(in_oklab,var(--terminal-ansi-red)_55%,transparent)] hover:bg-[color-mix(in_oklab,var(--terminal-ansi-red)_14%,var(--card))] hover:text-[var(--terminal-ansi-red)]",
        className,
      )}
    >
      {state.kind === "stopping" ? (
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-current/30 border-t-current motion-reduce:animate-none" />
      ) : (
        <HugeiconsIcon
          icon={stopped ? Tick02Icon : StopIcon}
          size={size === "md" ? 13 : 11}
          strokeWidth={2.2}
        />
      )}
      {stopLabel(state)}
    </button>
  );
}
