import type { PastChat, PromptMatch } from "./contextClient";

export type HistoryGroupId = "today" | "yesterday" | "week" | "older";

export type HistoryRow = {
  chat: PastChat;
  title: string;
  /** The first prompt, or the matching prompt text while searching. */
  preview: string | null;
  /** True when `preview` is a full-text match rather than the first prompt. */
  matched: boolean;
};

export type HistoryGroup = {
  id: HistoryGroupId;
  label: string;
  rows: HistoryRow[];
};

const GROUP_LABELS: Record<HistoryGroupId, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  older: "Older",
};

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The history bucket for a session last active at `ms`, seen from `now`. */
export function historyGroupOf(ms: number, now: number): HistoryGroupId {
  const today = startOfDay(now);
  if (ms >= today) return "today";
  if (ms >= today - DAY_MS) return "yesterday";
  if (ms >= today - 6 * DAY_MS) return "week";
  return "older";
}

/** A session's display title: a Terax name, then Claude's `/rename`, its AI title, the first prompt. */
export function chatTitle(
  chat: PastChat,
  customTitles: Readonly<Record<string, string>> = {},
): string {
  const name =
    customTitles[chat.sessionId] ??
    chat.customTitle ??
    chat.title ??
    chat.firstPrompt ??
    null;
  const trimmed = name?.trim();
  if (!trimmed) return "Untitled chat";
  return trimmed.length > 90 ? `${trimmed.slice(0, 89).trimEnd()}…` : trimmed;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Rows for `chats` filtered by `query` (every word must appear in the title
 * or first prompt), plus sessions found by the prompt full-text search.
 * Order stays newest first.
 */
export function filterHistory(
  chats: readonly PastChat[],
  query: string,
  matches: readonly PromptMatch[] = [],
  customTitles: Readonly<Record<string, string>> = {},
): HistoryRow[] {
  const words = normalize(query).split(" ").filter(Boolean);
  const byId = new Map(matches.map((m) => [m.sessionId, m.snippet]));
  const rows: HistoryRow[] = [];
  for (const chat of chats) {
    const title = chatTitle(chat, customTitles);
    const haystack = normalize(`${title} ${chat.firstPrompt ?? ""}`);
    const local = words.every((w) => haystack.includes(w));
    const snippet = byId.get(chat.sessionId);
    if (words.length > 0 && !local && !snippet) continue;
    rows.push({
      chat,
      title,
      preview: !local && snippet ? snippet : (chat.firstPrompt ?? null),
      matched: !local && !!snippet,
    });
  }
  return rows;
}

/** `rows` bucketed by recency; empty groups are left out. */
export function groupHistory(
  rows: readonly HistoryRow[],
  now: number,
): HistoryGroup[] {
  const groups = new Map<HistoryGroupId, HistoryRow[]>();
  for (const row of rows) {
    const id = historyGroupOf(row.chat.modifiedMs, now);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  return (["today", "yesterday", "week", "older"] as const)
    .filter((id) => groups.has(id))
    .map((id) => ({
      id,
      label: GROUP_LABELS[id],
      rows: groups.get(id) ?? [],
    }));
}

/** "just now", "5m ago", "3h ago", "yesterday", "4d ago", or a date. */
export function relativeTime(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (historyGroupOf(ms, now) === "today")
    return `${Math.floor(diff / 3_600_000)}h ago`;
  if (historyGroupOf(ms, now) === "yesterday") return "yesterday";
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(ms).getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
  });
}
