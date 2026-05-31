import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type UsageWindow = { utilization: number | null; resets_at: string | null };
type Usage = { five_hour: UsageWindow; seven_day: UsageWindow };

const POLL_MS = 60_000;
// Re-render this often so the "resets in Xm" countdown stays live between polls.
const TICK_MS = 30_000;
// At/above this the window is treated as exhausted (limit reached).
const LIMIT_PCT = 100;

function colorFor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  if (pct >= LIMIT_PCT) return "text-red-500";
  if (pct >= 80) return "text-red-500";
  if (pct >= 50) return "text-yellow-500";
  return "text-green-500";
}

function pctText(w: UsageWindow): string {
  return w.utilization == null ? "—" : `${Math.round(w.utilization)}%`;
}

function isLimited(w: UsageWindow): boolean {
  return w.utilization != null && w.utilization >= LIMIT_PCT;
}

function resetMs(w: UsageWindow): number | null {
  if (!w.resets_at) return null;
  const t = new Date(w.resets_at).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Compact "1h23m" / "5m" / "<1m" until the reset time, or null if unknown/past. */
function remainingText(w: UsageWindow, now: number): string | null {
  const t = resetMs(w);
  if (t == null) return null;
  const diff = t - now;
  if (diff <= 0) return null;
  const mins = Math.ceil(diff / 60_000);
  if (mins < 1) return "<1m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

function resetText(w: UsageWindow): string {
  const t = resetMs(w);
  if (t == null) return "unknown";
  return new Date(t).toLocaleString();
}

/**
 * Claude subscription usage indicator. Polls the Rust `claude_usage` command
 * (which reads the Claude Code OAuth token and queries the usage endpoint) and
 * shows 5-hour and 7-day limit utilization. When a window is exhausted it shows
 * "limit · resets in Xm" with a live countdown instead of the percentage, so a
 * hit limit stays visible (and keeps counting down) across refreshes. Hidden
 * entirely when usage is unavailable (no Claude Code login / not a subscription).
 */
export function ClaudeUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [now, setNow] = useState(() => Date.now());

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

  // Tick the clock so the countdown updates between the slower data polls.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!usage) return null;

  const fiveRemain = remainingText(usage.five_hour, now);
  const sevenRemain = remainingText(usage.seven_day, now);

  const title =
    `Claude usage\n` +
    `5-hour limit: ${pctText(usage.five_hour)}${isLimited(usage.five_hour) ? " — LIMIT REACHED" : ""} (resets ${resetText(usage.five_hour)})\n` +
    `7-day limit: ${pctText(usage.seven_day)}${isLimited(usage.seven_day) ? " — LIMIT REACHED" : ""} (resets ${resetText(usage.seven_day)})`;

  const renderWindow = (label: string, w: UsageWindow, remain: string | null) => {
    if (isLimited(w)) {
      return (
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold text-red-500">limit</span>
          {remain && (
            <span className="text-red-400">· {remain}</span>
          )}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={colorFor(w.utilization)}>{pctText(w)}</span>
      </span>
    );
  };

  return (
    <div
      className="hidden shrink-0 items-center gap-1.5 px-1.5 text-[11px] font-medium tabular-nums sm:flex"
      title={title}
    >
      {renderWindow("5h", usage.five_hour, fiveRemain)}
      <span className="text-muted-foreground/40">·</span>
      {renderWindow("7d", usage.seven_day, sevenRemain)}
    </div>
  );
}
