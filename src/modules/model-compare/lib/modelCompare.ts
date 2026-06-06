import {
  type CustomEndpoint,
  compatModelIdForEndpoint,
  getProvider,
  MODELS,
  type ProviderId,
  providerNeedsKey,
} from "@/modules/ai/config";

export const MODEL_COMPARE_MIN_MODELS = 2;
export const MODEL_COMPARE_MAX_MODELS = 4;

export type ModelCompareMode = "models" | "prompts" | "agent" | "research";

export type CompareCandidateInput = {
  id: string;
  label: string;
  provider?: string;
  description?: string;
  modelId?: string;
  prompt?: string;
};

export type CompareCandidate = CompareCandidateInput & {
  provider: string;
};

export type ComparePaneStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type ComparePaneMetrics = {
  startedAt: number;
  completedAt: number | null;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
};

export type ModelComparePane = {
  id: string;
  candidate: CompareCandidate;
  slotIndex: number;
  slotLabel: string;
  visibleLabel: string;
  status: ComparePaneStatus;
  response: string;
  error: string | null;
  metrics: ComparePaneMetrics | null;
};

export type ModelCompareVote =
  | {
      kind: "pane";
      paneId: string;
      candidateId: string;
      votedAt: number;
    }
  | { kind: "tie"; votedAt: number };

export type ModelCompareEvaluationScore = {
  paneId: string;
  score: number;
  rationale: string;
};

export type ModelCompareEvaluation = {
  judgedAt: number;
  judgeModelId: string;
  rubric: string;
  winner: string | "tie";
  summary: string;
  scores: ModelCompareEvaluationScore[];
};

export type ModelComparePublicSnapshot = {
  id: string;
  prompt: string;
  mode: ModelCompareMode;
  blind: boolean;
  revealed: boolean;
  createdAt: number;
  panes: Array<{
    id: string;
    slotIndex: number;
    slotLabel: string;
    visibleLabel: string;
    status: ComparePaneStatus;
    response: string;
    error: string | null;
    metrics: ComparePaneMetrics | null;
  }>;
  vote: ModelCompareVote | null;
  evaluation?: ModelCompareEvaluation | null;
};

export type ModelCompareRun = {
  id: string;
  prompt: string;
  mode: ModelCompareMode;
  blind: boolean;
  revealed: boolean;
  createdAt: number;
  panes: ModelComparePane[];
  vote: ModelCompareVote | null;
  evaluation?: ModelCompareEvaluation | null;
  publicSnapshot: ModelComparePublicSnapshot;
};

type RunInput = {
  id: string;
  prompt: string;
  mode?: ModelCompareMode;
  candidates: readonly CompareCandidateInput[];
  blind: boolean;
  now: number;
};

type VoteInput = { kind: "pane"; paneId: string } | { kind: "tie" };

export type BuildCompareCandidatesInput = {
  keys: Partial<Record<ProviderId, string | null | undefined>>;
  localModels?: {
    lmstudioModelId?: string | null;
    mlxModelId?: string | null;
    ollamaModelId?: string | null;
    openaiCompatibleModelId?: string | null;
    openrouterModelId?: string | null;
  };
  customEndpoints?: readonly CustomEndpoint[];
};

export type ModelCompareScoreRecord = {
  models: readonly string[];
  winner: string | "tie";
  costs?: readonly (number | null | undefined)[];
};

export type ModelCompareScore = {
  model: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  winRate: number;
  averageCostUsd: number | null;
};

function normalizeCandidate(
  candidate: CompareCandidateInput,
): CompareCandidate {
  return {
    ...candidate,
    id: candidate.id.trim(),
    label: candidate.label.trim(),
    provider: candidate.provider?.trim() || "Model",
    description: candidate.description?.trim() || undefined,
    modelId: candidate.modelId?.trim() || undefined,
    prompt: candidate.prompt?.trim() || undefined,
  };
}

function assertValidRunInput(input: RunInput): CompareCandidate[] {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Prompt is required");
  const candidates = input.candidates.map(normalizeCandidate);
  if (
    candidates.length < MODEL_COMPARE_MIN_MODELS ||
    candidates.length > MODEL_COMPARE_MAX_MODELS
  ) {
    throw new Error("Select 2 to 4 models");
  }
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.id || !candidate.label) {
      throw new Error("Every compare model needs an id and label");
    }
    if (ids.has(candidate.id)) {
      throw new Error(`Duplicate compare model: ${candidate.label}`);
    }
    ids.add(candidate.id);
  }
  return candidates;
}

function slotLabel(index: number): string {
  return `Model ${String.fromCharCode(65 + index)}`;
}

function attachPublicSnapshot(
  run: Omit<ModelCompareRun, "publicSnapshot">,
): ModelCompareRun {
  return { ...run, publicSnapshot: buildPublicSnapshot(run) };
}

function buildPublicSnapshot(
  run: Omit<ModelCompareRun, "publicSnapshot">,
): ModelComparePublicSnapshot {
  return {
    id: run.id,
    prompt: run.prompt,
    mode: run.mode,
    blind: run.blind,
    revealed: run.revealed,
    createdAt: run.createdAt,
    panes: run.panes.map((pane) => ({
      id: pane.id,
      slotIndex: pane.slotIndex,
      slotLabel: pane.slotLabel,
      visibleLabel: pane.visibleLabel,
      status: pane.status,
      response: pane.response,
      error: pane.error,
      metrics: pane.metrics,
    })),
    vote: run.vote,
    evaluation: run.evaluation ?? null,
  };
}

function withRevealedLabels(run: ModelCompareRun): ModelCompareRun {
  return attachPublicSnapshot({
    ...run,
    revealed: true,
    panes: run.panes.map((pane) => ({
      ...pane,
      visibleLabel: pane.candidate.label,
    })),
  });
}

export function createModelCompareRun(input: RunInput): ModelCompareRun {
  const candidates = assertValidRunInput(input);
  const base = {
    id: input.id,
    prompt: input.prompt.trim(),
    mode: input.mode ?? "models",
    blind: input.blind,
    revealed: !input.blind,
    createdAt: input.now,
    vote: null,
    evaluation: null,
    panes: candidates.map((candidate, index) => {
      const neutral = slotLabel(index);
      return {
        id: `pane_${index + 1}`,
        candidate,
        slotIndex: index,
        slotLabel: neutral,
        visibleLabel: input.blind ? neutral : candidate.label,
        status: "idle" as const,
        response: "",
        error: null,
        metrics: null,
      };
    }),
  };
  return attachPublicSnapshot(base);
}

export function revealModelCompareRun(run: ModelCompareRun): ModelCompareRun {
  if (run.revealed) return run;
  return withRevealedLabels(run);
}

export function voteModelCompareRun(
  run: ModelCompareRun,
  vote: VoteInput,
  now: number,
): ModelCompareRun {
  if (run.vote) throw new Error("Model compare run already has a vote");
  const nextVote: ModelCompareVote =
    vote.kind === "tie"
      ? { kind: "tie", votedAt: now }
      : (() => {
          const pane = run.panes.find((item) => item.id === vote.paneId);
          if (!pane) throw new Error("Unknown compare pane");
          return {
            kind: "pane" as const,
            paneId: pane.id,
            candidateId: pane.candidate.id,
            votedAt: now,
          };
        })();

  return withRevealedLabels(attachPublicSnapshot({ ...run, vote: nextVote }));
}

export function buildModelCompareJudgePrompt(
  run: ModelCompareRun,
  rubric: string,
): string {
  const panes = run.panes.map((pane) => ({
    paneId: pane.id,
    label: pane.slotLabel,
    prompt: pane.candidate.prompt ?? run.prompt,
    response: pane.response,
  }));
  return [
    "You are judging a blind model comparison inside Terax.",
    "Use only the provided prompt, rubric, and responses.",
    "Return only strict JSON with this shape:",
    '{"winner":"pane_1|pane_2|tie","summary":"...","scores":[{"paneId":"pane_1","score":1-10,"rationale":"..."}]}',
    "",
    `Rubric: ${rubric.trim() || "Prefer correctness, completeness, and clarity."}`,
    `Original prompt: ${run.prompt}`,
    "Responses:",
    JSON.stringify(panes, null, 2),
  ].join("\n");
}

export function parseModelCompareJudgeResult(
  raw: string,
  run: ModelCompareRun,
  judgedAt: number,
  judgeModelId = "judge",
  rubric = "",
): ModelCompareEvaluation {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) throw new Error("Judge result must be a JSON object");
  const paneIds = new Set(run.panes.map((pane) => pane.id));
  const winner = typeof parsed.winner === "string" ? parsed.winner : "tie";
  if (winner !== "tie" && !paneIds.has(winner)) {
    throw new Error("Judge winner does not match a compare pane");
  }
  const scoresInput = Array.isArray(parsed.scores) ? parsed.scores : [];
  const scores = scoresInput.filter(isRecord).map((score) => {
    const paneId = typeof score.paneId === "string" ? score.paneId : "";
    if (!paneIds.has(paneId)) throw new Error("Judge score has unknown pane");
    return {
      paneId,
      score: clampScore(score.score),
      rationale:
        typeof score.rationale === "string" ? score.rationale.trim() : "",
    };
  });
  return {
    judgedAt,
    judgeModelId,
    rubric,
    winner,
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    scores,
  };
}

export function applyModelCompareEvaluation(
  run: ModelCompareRun,
  evaluation: ModelCompareEvaluation,
): ModelCompareRun {
  return attachPublicSnapshot({ ...run, evaluation });
}

export function formatModelCompareEvaluationWinner(
  run: ModelCompareRun,
): string {
  const winner = run.evaluation?.winner;
  if (!winner) return "Not judged";
  if (winner === "tie") return "Tie";
  const pane = run.panes.find((item) => item.id === winner);
  return pane?.visibleLabel || pane?.candidate.label || winner;
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Judge result did not include JSON");
  }
  return raw.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampScore(value: unknown): number {
  const score = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(1, Math.min(10, Math.round(score)));
}

export function buildCompareArtifactMarkdown(run: ModelCompareRun): string {
  const winner = formatWinner(run);
  const lines = [
    "# Model Compare",
    "",
    `**Prompt:** ${run.prompt}`,
    `**Mode:** ${run.mode}`,
    `**Blind:** ${run.blind ? "Yes" : "No"}`,
    `**Winner:** ${winner}`,
    "",
    "| Model | Status | Latency | Tokens | Cost |",
    "| --- | --- | ---: | ---: | ---: |",
  ];

  for (const pane of run.panes) {
    const metrics = pane.metrics;
    const tokens = metrics
      ? `${metrics.inputTokens + metrics.outputTokens}`
      : "-";
    lines.push(
      `| ${escapeMarkdownTable(pane.candidate.label)} | ${pane.status} | ${
        metrics?.latencyMs == null ? "-" : formatDuration(metrics.latencyMs)
      } | ${tokens} | ${formatCost(metrics?.costUsd ?? null)} |`,
    );
  }

  if (run.evaluation) {
    lines.push("", "## Judge Evaluation", "");
    lines.push(`**Judge:** ${run.evaluation.judgeModelId}`, "");
    lines.push(`**Rubric:** ${run.evaluation.rubric}`, "");
    lines.push(`**Winner:** ${formatModelCompareEvaluationWinner(run)}`, "");
    lines.push(run.evaluation.summary, "");
    for (const score of run.evaluation.scores) {
      const pane = run.panes.find((item) => item.id === score.paneId);
      lines.push(
        `- ${pane?.candidate.label ?? score.paneId}: ${score.score}/10 - ${score.rationale}`,
      );
    }
    lines.push("");
  }

  lines.push("");
  for (const pane of run.panes) {
    lines.push(`## ${pane.candidate.label}`, "");
    if (pane.candidate.prompt) {
      lines.push(`**Prompt variant:** ${pane.candidate.prompt}`, "");
    }
    if (pane.metrics) {
      lines.push(
        `_${formatDuration(pane.metrics.latencyMs ?? 0)} · ${
          pane.metrics.inputTokens
        } input · ${pane.metrics.outputTokens} output · ${formatCost(
          pane.metrics.costUsd,
        )}_`,
        "",
      );
    }
    if (pane.error) {
      lines.push(`> Error: ${pane.error}`, "");
    }
    lines.push(pane.response.trim() || "_(no response)_", "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatWinner(run: ModelCompareRun): string {
  const vote = run.vote;
  if (!vote) return "Not voted";
  if (vote.kind === "tie") return "Tie";
  return (
    run.panes.find((pane) => pane.id === vote.paneId)?.candidate.label ??
    "Unknown"
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number | null): string {
  if (cost == null) return "-";
  if (cost < 0.0001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(4)}`;
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function hasConfiguredKey(
  keys: Partial<Record<ProviderId, string | null | undefined>>,
  provider: ProviderId,
): boolean {
  return !providerNeedsKey(provider) || Boolean(keys[provider]?.trim());
}

function configuredLocalId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildCompareCandidates({
  keys,
  localModels = {},
  customEndpoints = [],
}: BuildCompareCandidatesInput): CompareCandidate[] {
  const candidates: CompareCandidate[] = [];

  for (const model of MODELS) {
    const providerLabel = getProvider(model.provider).label;
    if (model.id === "lmstudio-local") {
      const modelId = configuredLocalId(localModels.lmstudioModelId);
      if (modelId) {
        candidates.push({
          id: model.id,
          label: `${model.label} · ${modelId}`,
          provider: providerLabel,
          description: model.description,
        });
      }
      continue;
    }
    if (model.id === "mlx-local") {
      const modelId = configuredLocalId(localModels.mlxModelId);
      if (modelId) {
        candidates.push({
          id: model.id,
          label: `${model.label} · ${modelId}`,
          provider: providerLabel,
          description: model.description,
        });
      }
      continue;
    }
    if (model.id === "ollama-local") {
      const modelId = configuredLocalId(localModels.ollamaModelId);
      if (modelId) {
        candidates.push({
          id: model.id,
          label: `${model.label} · ${modelId}`,
          provider: providerLabel,
          description: model.description,
        });
      }
      continue;
    }
    if (model.id === "openai-compatible-custom") {
      const modelId = configuredLocalId(localModels.openaiCompatibleModelId);
      if (modelId) {
        candidates.push({
          id: model.id,
          label: `${model.label} · ${modelId}`,
          provider: providerLabel,
          description: model.description,
        });
      }
      continue;
    }
    if (model.id === "openrouter-custom") {
      const modelId = configuredLocalId(localModels.openrouterModelId);
      if (modelId && hasConfiguredKey(keys, "openrouter")) {
        candidates.push({
          id: model.id,
          label: `${model.label} · ${modelId}`,
          provider: providerLabel,
          description: model.description,
        });
      }
      continue;
    }
    if (!hasConfiguredKey(keys, model.provider)) continue;
    candidates.push({
      id: model.id,
      label: model.label,
      provider: providerLabel,
      description: model.description,
    });
  }

  for (const endpoint of customEndpoints) {
    const name = endpoint.name.trim();
    const modelId = endpoint.modelId.trim();
    if (!endpoint.baseURL.trim() || !modelId) continue;
    candidates.push({
      id: compatModelIdForEndpoint(endpoint.id),
      label: `${name || "Custom endpoint"} · ${modelId}`,
      provider: "OpenAI Compatible",
      description: endpoint.baseURL.trim(),
    });
  }

  return candidates;
}

export function aggregateModelCompareScores(
  records: readonly ModelCompareScoreRecord[],
): ModelCompareScore[] {
  const stats = new Map<
    string,
    {
      wins: number;
      losses: number;
      ties: number;
      games: number;
      totalCost: number;
      costCount: number;
    }
  >();

  function ensure(model: string) {
    let entry = stats.get(model);
    if (!entry) {
      entry = {
        wins: 0,
        losses: 0,
        ties: 0,
        games: 0,
        totalCost: 0,
        costCount: 0,
      };
      stats.set(model, entry);
    }
    return entry;
  }

  for (const record of records) {
    record.models.forEach((model, index) => {
      const entry = ensure(model);
      entry.games += 1;
      if (record.winner === "tie") entry.ties += 1;
      else if (record.winner === model) entry.wins += 1;
      else entry.losses += 1;

      const cost = record.costs?.[index];
      if (typeof cost === "number" && Number.isFinite(cost)) {
        entry.totalCost += cost;
        entry.costCount += 1;
      }
    });
  }

  return Array.from(stats.entries())
    .map(([model, entry]) => ({
      model,
      wins: entry.wins,
      losses: entry.losses,
      ties: entry.ties,
      games: entry.games,
      winRate: entry.games > 0 ? entry.wins / entry.games : 0,
      averageCostUsd:
        entry.costCount > 0
          ? roundMetric(entry.totalCost / entry.costCount)
          : null,
    }))
    .sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.games !== a.games) return b.games - a.games;
      return a.model.localeCompare(b.model);
    });
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}
