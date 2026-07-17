import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import {
  aggregateAgentPhases,
  leafIds,
  ptyIdForLeaf,
  useAgentActivityStore,
} from "@/modules/terminal";
import type { Tab } from "./lib/useTabs";

// Fixed status hues (light/dark aware) matching the app's other status dots
// (diagnostics amber, tool-approval amber); attention reuses the approval amber.
const DOT_CLASS: Record<"working" | "attention", string> = {
  working: "bg-sky-500 dark:bg-sky-400",
  attention: "bg-amber-500 dark:bg-amber-400",
};

export function AgentTabBadge({ tab }: { tab: Tab }) {
  const phases = useAgentActivityStore((s) => s.phases);
  if (tab.kind !== "terminal") return null;

  const ptyIds: number[] = [];
  for (const leaf of leafIds(tab.paneTree)) {
    const id = ptyIdForLeaf(leaf);
    if (id !== null) ptyIds.push(id);
  }

  const { top, count } = aggregateAgentPhases(phases, ptyIds);
  if (!top) return null;

  const label = `${count} agent${count === 1 ? "" : "s"} · ${top}`;

  return (
    <span
      data-no-drag
      role="img"
      className="flex shrink-0 items-center gap-0.5"
      aria-label={label}
      title={label}
    >
      {top === "finished" ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={11}
          strokeWidth={2.5}
          className="text-emerald-600 dark:text-emerald-400"
        />
      ) : (
        <span className="relative flex size-2">
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-70 motion-reduce:hidden",
              DOT_CLASS[top],
            )}
          />
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              DOT_CLASS[top],
            )}
          />
        </span>
      )}
      {count > 1 ? (
        <span className="text-[9px] font-semibold tabular-nums text-foreground/70">
          {count}
        </span>
      ) : null}
    </span>
  );
}
