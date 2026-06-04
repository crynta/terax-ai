import { invoke } from "@tauri-apps/api/core";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── normalized model ────────────────────────────────────────────────────────
// Each provider resolves to the same shape so the header renders uniformly.
// `resets_at` is either an ISO-8601 string (Claude) or epoch-millis digits
// (Codex) — `toMs` accepts both.
type UsageWindow = { label: string; utilization: number | null; resets_at: string | null };
type Usage = { windows: UsageWindow[]; note: string | null };

type ProviderId = "claude" | "codex" | "cursor";

type CliStatus = { installed: boolean; authed: boolean };
type AgentClis = Record<ProviderId, CliStatus>;

type ProviderDef = {
  id: ProviderId;
  label: string;
  /** Fetch + normalize this provider's usage from its Rust command. */
  load: () => Promise<Usage>;
};

// Claude's command predates the normalized shape, so map it here.
type ClaudeRaw = {
  five_hour: { utilization: number | null; resets_at: string | null };
  seven_day: { utilization: number | null; resets_at: string | null };
};

const PROVIDERS: ProviderDef[] = [
  {
    id: "claude",
    label: "Claude Code",
    load: async () => {
      const u = await invoke<ClaudeRaw>("claude_usage");
      return {
        windows: [
          { label: "5h", ...u.five_hour },
          { label: "7d", ...u.seven_day },
        ],
        note: null,
      };
    },
  },
  {
    id: "codex",
    label: "Codex",
    load: () => invoke<Usage>("codex_usage"),
  },
  {
    id: "cursor",
    label: "Cursor",
    load: () => invoke<Usage>("cursor_usage"),
  },
];

const PROVIDER_BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

const STORAGE_KEY = "terax.usageProvider";
const DEFAULT_PROVIDER: ProviderId = "claude";

const POLL_MS = 60_000;
// Re-render this often so the "resets in Xm" countdown stays live between polls.
const TICK_MS = 30_000;
// At/above this the window is treated as exhausted (limit reached).
const LIMIT_PCT = 100;

function loadStoredProvider(): ProviderId {
  const v = localStorage.getItem(STORAGE_KEY);
  return v && PROVIDER_BY_ID.has(v as ProviderId) ? (v as ProviderId) : DEFAULT_PROVIDER;
}

function colorFor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
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

/** ISO-8601 string or epoch-millis digit-string → epoch ms, or null. */
function toMs(resets_at: string | null): number | null {
  if (!resets_at) return null;
  if (/^\d+$/.test(resets_at)) return Number(resets_at);
  const t = Date.parse(resets_at);
  return Number.isNaN(t) ? null : t;
}

/** Compact "1h23m" / "5m" / "<1m" until the reset time, or null if unknown/past. */
function remainingText(w: UsageWindow, now: number): string | null {
  const t = toMs(w.resets_at);
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
  const t = toMs(w.resets_at);
  if (t == null) return "unknown";
  return new Date(t).toLocaleString();
}

/** Why a provider can't show usage, or null if it can. */
function unavailableReason(s: CliStatus | undefined): string | null {
  if (!s) return "not supported";
  if (s.authed) return null;
  if (s.installed) return "sign-in required";
  return "not installed";
}

/**
 * Coding-agent usage indicator with a provider switcher. Shows the selected
 * agent's limit-window utilization (e.g. Claude Code's 5h/7d, Codex's
 * primary/secondary windows), polling that agent's Rust command. Click to
 * switch agents; the choice is persisted. Agents whose CLI isn't installed or
 * isn't signed in are shown disabled with the reason. Hidden entirely when no
 * supported agent is usable.
 */
export function AgentUsage() {
  const [provider, setProvider] = useState<ProviderId>(loadStoredProvider);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clis, setClis] = useState<AgentClis | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refreshClis = useCallback(() => {
    invoke<AgentClis>("agent_usage_clis")
      .then(setClis)
      .catch(() => setClis(null));
  }, []);

  useEffect(() => {
    refreshClis();
  }, [refreshClis]);

  // Poll the selected provider. Re-runs (and resets state) when it changes.
  useEffect(() => {
    let cancelled = false;
    const def = PROVIDER_BY_ID.get(provider);
    if (!def) return;
    setUsage(null);
    setError(null);
    const load = () => {
      def
        .load()
        .then((u) => {
          if (!cancelled) {
            setUsage(u);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setUsage(null);
            setError(typeof e === "string" ? e : "unavailable");
          }
        });
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [provider]);

  // Tick the clock so the countdown updates between the slower data polls.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const select = (id: ProviderId) => {
    setProvider(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  // Hide the whole indicator until we know nothing is usable, then stay hidden
  // if no supported agent is signed in — don't clutter the header.
  const anyAuthed = clis ? PROVIDERS.some((p) => clis[p.id]?.authed) : false;
  if (clis && !anyAuthed) return null;

  const def = PROVIDER_BY_ID.get(provider)!;
  const selectedReason = unavailableReason(clis?.[provider]);
  const windows = usage?.windows ?? [];

  const renderWindow = (w: UsageWindow, remain: string | null) => {
    if (isLimited(w)) {
      return (
        <span key={w.label} className="flex items-center gap-1">
          <span className="text-muted-foreground">{w.label}</span>
          <span className="font-semibold text-red-500">limit</span>
          {remain && <span className="text-red-400">· {remain}</span>}
        </span>
      );
    }
    return (
      <span key={w.label} className="flex items-center gap-1">
        <span className="text-muted-foreground">{w.label}</span>
        <span className={colorFor(w.utilization)}>{pctText(w)}</span>
      </span>
    );
  };

  const tooltip =
    `${def.label} usage\n` +
    (selectedReason
      ? selectedReason
      : windows.length
        ? windows
            .map(
              (w) =>
                `${w.label}: ${pctText(w)}${isLimited(w) ? " — LIMIT REACHED" : ""} (resets ${resetText(w)})`,
            )
            .join("\n") + (usage?.note ? `\n${usage.note}` : "")
        : (error ?? "loading…"));

  return (
    <DropdownMenu onOpenChange={(open) => open && refreshClis()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={tooltip}
          className="hidden shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums hover:bg-accent/50 sm:flex"
        >
          <span className="text-muted-foreground/70">{def.label}</span>
          {selectedReason ? (
            <span className="text-muted-foreground italic">{selectedReason}</span>
          ) : windows.length ? (
            windows.flatMap((w, i) => {
              const el = renderWindow(w, remainingText(w, now));
              return i === 0
                ? [el]
                : [
                    <span key={`sep-${w.label}`} className="text-muted-foreground/40">
                      ·
                    </span>,
                    el,
                  ];
            })
          ) : (
            <span className="text-muted-foreground">{error ?? "…"}</span>
          )}
          <HugeiconsIcon icon={ArrowDown01Icon} className="size-3 text-muted-foreground/50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Usage</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={provider} onValueChange={(v) => select(v as ProviderId)}>
          {PROVIDERS.map((p) => {
            const reason = unavailableReason(clis?.[p.id]);
            return (
              <DropdownMenuRadioItem
                key={p.id}
                value={p.id}
                disabled={!!reason}
                className="flex items-center justify-between gap-3"
              >
                <span>{p.label}</span>
                {reason && (
                  <span className="text-muted-foreground text-[10px] italic">{reason}</span>
                )}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
