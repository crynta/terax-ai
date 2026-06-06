import type {
  ModelCompareMode,
  ModelCompareRun,
  ModelCompareScoreRecord,
  ModelCompareVote,
} from "./modelCompare";

export const MODEL_COMPARE_HISTORY_LIMIT = 50;

export type ModelCompareHistoryEntry = {
  id: string;
  savedAt: number;
  run: ModelCompareRun;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVote(value: unknown): value is ModelCompareVote | null {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "tie") return typeof value.votedAt === "number";
  return (
    value.kind === "pane" &&
    typeof value.paneId === "string" &&
    typeof value.candidateId === "string" &&
    typeof value.votedAt === "number"
  );
}

function isModelCompareMode(value: unknown): value is ModelCompareMode {
  return (
    value === "models" ||
    value === "prompts" ||
    value === "agent" ||
    value === "research"
  );
}

function isModelCompareRun(value: unknown): value is ModelCompareRun {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.prompt !== "string" ||
    !isModelCompareMode(value.mode) ||
    typeof value.blind !== "boolean" ||
    typeof value.revealed !== "boolean" ||
    typeof value.createdAt !== "number" ||
    !Array.isArray(value.panes) ||
    value.panes.length < 2 ||
    value.panes.length > 4 ||
    !isVote(value.vote) ||
    !isRecord(value.publicSnapshot)
  ) {
    return false;
  }

  return value.panes.every((pane) => {
    if (!isRecord(pane) || !isRecord(pane.candidate)) return false;
    return (
      typeof pane.id === "string" &&
      typeof pane.candidate.id === "string" &&
      typeof pane.candidate.label === "string" &&
      typeof pane.candidate.provider === "string" &&
      typeof pane.slotIndex === "number" &&
      typeof pane.slotLabel === "string" &&
      typeof pane.visibleLabel === "string" &&
      typeof pane.status === "string" &&
      typeof pane.response === "string" &&
      (pane.error === null || typeof pane.error === "string")
    );
  });
}

function isHistoryEntry(value: unknown): value is ModelCompareHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.savedAt === "number" &&
    isModelCompareRun(value.run) &&
    value.id === value.run.id
  );
}

export function serializeModelCompareHistory(
  entries: readonly ModelCompareHistoryEntry[],
): string {
  return JSON.stringify(entries.slice(0, MODEL_COMPARE_HISTORY_LIMIT));
}

export function parseModelCompareHistoryValue(
  value: unknown,
): ModelCompareHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isHistoryEntry)
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MODEL_COMPARE_HISTORY_LIMIT);
}

export function parseModelCompareHistory(
  raw: string | null | undefined,
): ModelCompareHistoryEntry[] {
  if (!raw) return [];
  try {
    return parseModelCompareHistoryValue(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function upsertModelCompareHistory(
  entries: readonly ModelCompareHistoryEntry[],
  run: ModelCompareRun,
  savedAt: number,
  limit = MODEL_COMPARE_HISTORY_LIMIT,
): ModelCompareHistoryEntry[] {
  const next = entries.filter((entry) => entry.id !== run.id);
  next.push({ id: run.id, savedAt, run });
  return next.sort((a, b) => b.savedAt - a.savedAt).slice(0, limit);
}

export function compareRunToScoreRecord(
  run: ModelCompareRun,
): ModelCompareScoreRecord | null {
  const vote = run.vote;
  if (!vote) return null;
  const winner =
    vote.kind === "tie"
      ? "tie"
      : (run.panes.find((pane) => pane.id === vote.paneId)?.candidate.label ??
        null);
  if (!winner) return null;
  return {
    models: run.panes.map((pane) => pane.candidate.label),
    winner,
    costs: run.panes.map((pane) => pane.metrics?.costUsd ?? null),
  };
}

export function scoreRecordsFromCompareHistory(
  entries: readonly ModelCompareHistoryEntry[],
): ModelCompareScoreRecord[] {
  return entries
    .map((entry) => compareRunToScoreRecord(entry.run))
    .filter((record): record is ModelCompareScoreRecord => record !== null);
}

export function modelCompareHistoryTitle(
  entry: ModelCompareHistoryEntry,
): string {
  const title = historyRunTitle(entry.run);
  const shortTitle = title.length > 52 ? `${title.slice(0, 51)}…` : title;
  return `${shortTitle || "Untitled comparison"} · ${winnerLabel(entry.run)}`;
}

function historyRunTitle(run: ModelCompareRun): string {
  if (run.mode === "prompts") {
    const modelLabel = run.panes[0]?.candidate.provider?.trim();
    return modelLabel ? `Prompt variants · ${modelLabel}` : "Prompt variants";
  }
  return run.prompt.trim().replace(/\s+/g, " ");
}

function winnerLabel(run: ModelCompareRun): string {
  const vote = run.vote;
  if (!vote) return "Not voted";
  if (vote.kind === "tie") return "Tie";
  return (
    run.panes.find((pane) => pane.id === vote.paneId)?.candidate.label ??
    "Winner"
  );
}
