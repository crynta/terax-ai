/**
 * Session-level facts for the Reader's info bar: the model, how full its
 * context window is, how long the session has run, and how much it changed.
 * Derived from transcript entries only; cost is deliberately not estimated.
 */

import { turnCalls } from "./readerDoc";
import type {
  ReaderTurn,
  TranscriptEntry,
  TranscriptUsage,
} from "./transcript";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const EXTENDED_CONTEXT_WINDOW = 1_000_000;

export type SessionInfo = {
  /** Friendly model name, e.g. "Opus 5.5". */
  model: string | null;
  modelId: string | null;
  /** Tokens the last main-thread reply had in context. */
  contextUsed: number | null;
  contextWindow: number | null;
  /** 0–100, rounded down, or null without usage data. */
  contextPercent: number | null;
  /** Output tokens of every main-thread reply. */
  outputTokens: number;
  /** First and latest entry times (ms since epoch). */
  startedAt: number | null;
  lastAt: number | null;
  /** Lines added and removed by Edit/Write diffs. */
  added: number;
  removed: number;
};

const FAMILY_FIRST = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?=$|-|\[))?/;
const VERSION_FIRST = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?=$|-|\[)/;

/** "claude-opus-5-5" → "Opus 5.5"; "claude-3-5-sonnet-20241022" → "Sonnet 3.5". */
export function modelLabel(id: string): string {
  const extended = /\[1m\]|-1m\b/i.test(id);
  const base = id.replace(/\[1m\]/i, "");
  const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  let label: string | null = null;
  const family = FAMILY_FIRST.exec(base);
  if (family) {
    label = `${title(family[1])} ${family[2]}${family[3] ? `.${family[3]}` : ""}`;
  } else {
    const version = VERSION_FIRST.exec(base);
    if (version) {
      label = `${title(version[3])} ${version[1]}${version[2] ? `.${version[2]}` : ""}`;
    }
  }
  if (!label) return id;
  return extended ? `${label} (1M)` : label;
}

/** The model's context window: 1M for `[1m]` variants, 200k otherwise. */
export function contextWindowFor(id: string | null): number {
  return id && /\[1m\]|-1m\b/i.test(id)
    ? EXTENDED_CONTEXT_WINDOW
    : DEFAULT_CONTEXT_WINDOW;
}

function contextOf(usage: TranscriptUsage): number {
  return (
    usage.inputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens
  );
}

function sameUsage(a: TranscriptUsage, b: TranscriptUsage): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cacheReadInputTokens === b.cacheReadInputTokens &&
    a.cacheCreationInputTokens === b.cacheCreationInputTokens
  );
}

function time(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function sessionInfo(
  entries: readonly TranscriptEntry[],
  turns: readonly ReaderTurn[],
): SessionInfo {
  let modelId: string | null = null;
  let last: TranscriptUsage | null = null;
  let outputTokens = 0;
  let startedAt: number | null = null;
  let lastAt: number | null = null;
  for (const entry of entries) {
    const at = time(entry.timestamp);
    if (at !== null) {
      startedAt ??= at;
      lastAt = at;
    }
    if (entry.kind !== "assistant" || entry.isSidechain) continue;
    if (entry.model) modelId = entry.model;
    const usage = entry.usage;
    if (!usage) continue;
    // One reply is written as several lines repeating the same usage.
    if (!last || !sameUsage(last, usage)) outputTokens += usage.outputTokens;
    last = usage;
  }
  let added = 0;
  let removed = 0;
  for (const turn of turns) {
    for (const call of turnCalls(turn)) {
      for (const line of call.diff ?? []) {
        if (line.kind === "add") added += 1;
        else if (line.kind === "remove") removed += 1;
      }
    }
  }
  const contextUsed = last ? contextOf(last) : null;
  const contextWindow = last ? contextWindowFor(modelId) : null;
  return {
    model: modelId ? modelLabel(modelId) : null,
    modelId,
    contextUsed,
    contextWindow,
    contextPercent:
      contextUsed !== null && contextWindow
        ? Math.min(100, Math.floor((contextUsed / contextWindow) * 100))
        : null,
    outputTokens,
    startedAt,
    lastAt,
    added,
    removed,
  };
}

/** 950 → "950", 4_520 → "4.5k", 12_340 → "12k", 1_250_000 → "1.25M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}
