import {
  type CompareCandidate,
  MODEL_COMPARE_MAX_MODELS,
  type ModelComparePane,
  type ModelCompareRun,
} from "./lib/modelCompare";
import {
  type ModelCompareHistoryEntry,
  parseModelCompareHistory,
  serializeModelCompareHistory,
} from "./lib/modelCompareHistory";
import type { ModelCompareProbeResult } from "./lib/runModelCompare";

const RUN_HISTORY_KEY = "terax.modelCompare.runs";
export const SAMPLE_PROMPT =
  "Explain the trade-offs of Rust vs TypeScript for a terminal app in 5 bullets.";
export const DEFAULT_JUDGE_RUBRIC =
  "Score correctness, completeness, specificity, and clarity. Penalize hallucinations and unnecessary verbosity.";
export const DEFAULT_PROMPT_VARIANTS = [
  SAMPLE_PROMPT,
  "Explain the trade-offs of Rust vs TypeScript for a terminal app with practical examples and a final recommendation.",
];

export type ProbeUiState = {
  status: "checking" | "ok" | "failed";
  latencyMs?: number | null;
  response?: string;
  error?: string | null;
};

export function makeRunId(): string {
  return `cmp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function readRunHistory(): ModelCompareHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return parseModelCompareHistory(
      window.localStorage.getItem(RUN_HISTORY_KEY),
    );
  } catch {
    return [];
  }
}

export function writeRunHistory(
  entries: readonly ModelCompareHistoryEntry[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RUN_HISTORY_KEY,
      serializeModelCompareHistory(entries),
    );
  } catch {
    // localStorage can be unavailable in restricted environments.
  }
}

export function formatMetricDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatMetricCost(cost: number | null | undefined): string {
  if (cost == null) return "-";
  if (cost < 0.0001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(4)}`;
}

export function normalizeSelection(
  ids: string[],
  candidates: readonly CompareCandidate[],
): string[] {
  const available = new Set(candidates.map((candidate) => candidate.id));
  const next = ids.filter(
    (id, index) => available.has(id) && ids.indexOf(id) === index,
  );
  for (const candidate of candidates) {
    if (next.length >= 2) break;
    if (!next.includes(candidate.id)) next.push(candidate.id);
  }
  return next.slice(0, MODEL_COMPARE_MAX_MODELS);
}

export function winnerLabel(run: ModelCompareRun): string {
  const vote = run.vote;
  if (!vote) return "Not voted";
  if (vote.kind === "tie") return "Tie";
  return (
    run.panes.find((pane) => pane.id === vote.paneId)?.candidate.label ??
    "Winner"
  );
}

function paneIsSettled(pane: ModelComparePane): boolean {
  return pane.status !== "idle" && pane.status !== "running";
}

export function modelCompareRunCanVote(
  run: ModelCompareRun | null,
  running: boolean,
): boolean {
  return (
    run !== null &&
    !running &&
    !run.vote &&
    run.panes.every(paneIsSettled) &&
    run.panes.some((pane) => pane.status === "completed")
  );
}

export function modelCompareRunCanTie(
  run: ModelCompareRun | null,
  running: boolean,
): boolean {
  return (
    modelCompareRunCanVote(run, running) &&
    run !== null &&
    run.panes.every((pane) => pane.status === "completed")
  );
}

export function modelCompareRunCanJudge(
  run: ModelCompareRun | null,
  running: boolean,
): boolean {
  return (
    run !== null &&
    !running &&
    run.panes.every((pane) => pane.status === "completed")
  );
}

export function candidateById(
  candidates: readonly CompareCandidate[],
  id: string,
): CompareCandidate | null {
  return candidates.find((candidate) => candidate.id === id) ?? null;
}

function publicPaneFromPane(
  pane: ModelComparePane,
): ModelCompareRun["publicSnapshot"]["panes"][number] {
  return {
    id: pane.id,
    slotIndex: pane.slotIndex,
    slotLabel: pane.slotLabel,
    visibleLabel: pane.visibleLabel,
    status: pane.status,
    response: pane.response,
    error: pane.error,
    metrics: pane.metrics,
  };
}

export function patchModelComparePaneForRun(
  run: ModelCompareRun,
  runId: string,
  paneId: string,
  patch: Partial<ModelComparePane>,
): ModelCompareRun {
  if (run.id !== runId) return run;
  const panes = run.panes.map((pane) =>
    pane.id === paneId ? { ...pane, ...patch } : pane,
  );
  return {
    ...run,
    panes,
    publicSnapshot: {
      ...run.publicSnapshot,
      panes: panes.map(publicPaneFromPane),
    },
  };
}

export function appendModelComparePaneDeltaForRun(
  run: ModelCompareRun,
  runId: string,
  paneId: string,
  delta: string,
): ModelCompareRun {
  if (run.id !== runId) return run;
  const panes = run.panes.map((pane) =>
    pane.id === paneId ? { ...pane, response: pane.response + delta } : pane,
  );
  return {
    ...run,
    panes,
    publicSnapshot: {
      ...run.publicSnapshot,
      panes: panes.map(publicPaneFromPane),
    },
  };
}

export function probeStateFromResult(
  result: ModelCompareProbeResult,
): ProbeUiState {
  return {
    status: result.status,
    latencyMs: result.latencyMs,
    response: result.response,
    error: result.error,
  };
}

export function promptCompareCandidates(
  model: CompareCandidate | null,
  variants: readonly string[],
): CompareCandidate[] {
  if (!model) return [];
  return variants
    .map((variant) => variant.trim())
    .filter((variant) => variant.length > 0)
    .slice(0, MODEL_COMPARE_MAX_MODELS)
    .map((variant, index) => ({
      id: `prompt_${index + 1}_${model.id}`,
      label: `Prompt ${String.fromCharCode(65 + index)}`,
      provider: model.label,
      modelId: model.modelId ?? model.id,
      prompt: variant,
      description: `Prompt variant on ${model.label}`,
    }));
}

export function promptVariantsFromRun(run: ModelCompareRun): string[] {
  if (run.mode !== "prompts") return [...DEFAULT_PROMPT_VARIANTS];
  const variants = run.panes
    .map((pane) => pane.candidate.prompt?.trim() ?? "")
    .filter(Boolean)
    .slice(0, MODEL_COMPARE_MAX_MODELS);
  return variants.length >= 2 ? variants : [...DEFAULT_PROMPT_VARIANTS];
}

export function selectionIdsFromRun(
  run: ModelCompareRun,
  candidates: readonly CompareCandidate[],
): string[] {
  if (run.mode === "prompts") {
    const paneCandidate = run.panes[0]?.candidate;
    const modelId = paneCandidate?.modelId;
    const modelLabel = paneCandidate?.provider;
    const matchingModel = candidates.find(
      (candidate) =>
        candidate.id === modelId ||
        candidate.modelId === modelId ||
        candidate.label === modelLabel,
    );
    return normalizeSelection(
      matchingModel ? [matchingModel.id] : [],
      candidates,
    );
  }
  return normalizeSelection(
    run.panes.map((pane) => pane.candidate.id),
    candidates,
  );
}

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard is unavailable");
}

export function modelCompareErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const nativeError = error as { code?: unknown; message?: unknown };
    if (typeof nativeError.message === "string" && nativeError.message) {
      return typeof nativeError.code === "string" && nativeError.code
        ? `${nativeError.message} (${nativeError.code})`
        : nativeError.message;
    }
  }
  return String(error);
}

export function shouldClearModelCompareHistory(
  confirm: (message: string) => boolean = () => false,
): boolean {
  return confirm(
    "Clear all saved model compare history? This removes local and native history and cannot be undone.",
  );
}
