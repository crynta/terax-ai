import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type UsageWindow = { utilization: number | null; resets_at: string | null };
type Usage = { five_hour: UsageWindow; seven_day: UsageWindow };

const POLL_MS = 60_000;

function colorFor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= 80) return "text-red-500";
  if (pct >= 50) return "text-yellow-500";
  return "text-green-500";
}

function pctText(w: UsageWindow): string {
  return w.utilization == null ? "—" : `${Math.round(w.utilization)}%`;
}

function resetText(w: UsageWindow): string {
  if (!w.resets_at) return "unknown";
  const d = new Date(w.resets_at);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

/**
 * Claude subscription usage indicator. Polls the Rust `claude_usage` command
 * (which reads the Claude Code OAuth token and queries the usage endpoint) and
 * shows 5-hour and 7-day limit utilization. Hidden entirely when usage is
 * unavailable (no Claude Code login / not a subscription).
 */
export function ClaudeUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      invoke<Usage>("claude_usage")
        .then((u) => {
          if (!cancelled) setUsage(u);
        })
        .catch(() => {
          if (!cancelled) setUsage(null);
        });
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!usage) return null;

  const title =
    `Claude usage\n` +
    `5-hour limit: ${pctText(usage.five_hour)} (resets ${resetText(usage.five_hour)})\n` +
    `7-day limit: ${pctText(usage.seven_day)} (resets ${resetText(usage.seven_day)})`;

  return (
    <div
      className="hidden shrink-0 items-center gap-1.5 px-1.5 text-[11px] font-medium tabular-nums sm:flex"
      title={title}
    >
      <span className="text-muted-foreground">5h</span>
      <span className={colorFor(usage.five_hour.utilization)}>
        {pctText(usage.five_hour)}
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span className="text-muted-foreground">7d</span>
      <span className={colorFor(usage.seven_day.utilization)}>
        {pctText(usage.seven_day)}
      </span>
    </div>
  );
}
