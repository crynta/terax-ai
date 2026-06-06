import GitCompareIcon from "@hugeicons/core-free-icons/GitCompareIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { artifactsNative } from "@/modules/artifacts/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { saveModelCompareArtifact } from "./lib/artifacts";
import {
  aggregateModelCompareScores,
  applyModelCompareEvaluation,
  buildCompareArtifactMarkdown,
  buildCompareCandidates,
  buildModelCompareJudgePrompt,
  type CompareCandidate,
  createModelCompareRun,
  formatModelCompareEvaluationWinner,
  MODEL_COMPARE_MAX_MODELS,
  type ModelCompareMode,
  type ModelComparePane,
  type ModelCompareRun,
  parseModelCompareJudgeResult,
  revealModelCompareRun,
  voteModelCompareRun,
} from "./lib/modelCompare";
import {
  type ModelCompareHistoryEntry,
  scoreRecordsFromCompareHistory,
  upsertModelCompareHistory,
} from "./lib/modelCompareHistory";
import { modelCompareHistoryNative } from "./lib/native";
import {
  ModelCompareHistorySection,
  ModelCompareResultsSection,
  ModelCompareScoreboard,
} from "./ModelCompareRunSections";
import { ModelCompareSetupSections } from "./ModelCompareSetupSections";
import {
  buildCompareLocalConfig,
  probeModelCompareModel,
  runModelComparePane,
} from "./lib/runModelCompare";
import {
  candidateById,
  copyText,
  DEFAULT_JUDGE_RUBRIC,
  DEFAULT_PROMPT_VARIANTS,
  makeRunId,
  modelCompareErrorMessage,
  modelCompareRunCanJudge,
  modelCompareRunCanTie,
  modelCompareRunCanVote,
  normalizeSelection,
  patchModelComparePaneForRun,
  appendModelComparePaneDeltaForRun,
  type ProbeUiState,
  probeStateFromResult,
  promptCompareCandidates,
  promptVariantsFromRun,
  readRunHistory,
  SAMPLE_PROMPT,
  selectionIdsFromRun,
  shouldClearModelCompareHistory,
  winnerLabel,
  writeRunHistory,
} from "./ModelComparePanelUtils";
export {
  appendModelComparePaneDeltaForRun,
  modelCompareErrorMessage,
  modelCompareRunCanJudge,
  modelCompareRunCanTie,
  modelCompareRunCanVote,
  patchModelComparePaneForRun,
  shouldClearModelCompareHistory,
} from "./ModelComparePanelUtils";

type ModelComparePanelProps = {
  activeCwd?: string | null;
  workspaceRoot?: string | null;
  onOpenArtifactWorkspace?: (
    conversationId: string,
    slug?: string | null,
  ) => void;
};

export function ModelComparePanel({
  activeCwd = null,
  workspaceRoot = null,
  onOpenArtifactWorkspace,
}: ModelComparePanelProps = {}) {
  const apiKeys = useChatStore((state) => state.apiKeys);
  const customEndpointKeys = useChatStore((state) => state.customEndpointKeys);
  const customEndpoints = usePreferencesStore((state) => state.customEndpoints);
  const lmstudioBaseURL = usePreferencesStore((state) => state.lmstudioBaseURL);
  const lmstudioModelId = usePreferencesStore((state) => state.lmstudioModelId);
  const mlxBaseURL = usePreferencesStore((state) => state.mlxBaseURL);
  const mlxModelId = usePreferencesStore((state) => state.mlxModelId);
  const ollamaBaseURL = usePreferencesStore((state) => state.ollamaBaseURL);
  const ollamaModelId = usePreferencesStore((state) => state.ollamaModelId);
  const openaiCompatibleBaseURL = usePreferencesStore(
    (state) => state.openaiCompatibleBaseURL,
  );
  const openaiCompatibleContextLimit = usePreferencesStore(
    (state) => state.openaiCompatibleContextLimit,
  );
  const openaiCompatibleModelId = usePreferencesStore(
    (state) => state.openaiCompatibleModelId,
  );
  const openrouterModelId = usePreferencesStore(
    (state) => state.openrouterModelId,
  );
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [promptVariants, setPromptVariants] = useState<string[]>(() => [
    ...DEFAULT_PROMPT_VARIANTS,
  ]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<ModelCompareMode>("models");
  const [blind, setBlind] = useState(true);
  const [parallel, setParallel] = useState(true);
  const [run, setRun] = useState<ModelCompareRun | null>(null);
  const [running, setRunning] = useState(false);
  const [probing, setProbing] = useState(false);
  const [judging, setJudging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [judgeModelId, setJudgeModelId] = useState<string>("");
  const [judgeRubric, setJudgeRubric] = useState(DEFAULT_JUDGE_RUBRIC);
  const [probeResults, setProbeResults] = useState<
    Record<string, ProbeUiState>
  >({});
  const [runHistory, setRunHistory] = useState<ModelCompareHistoryEntry[]>(() =>
    readRunHistory(),
  );
  const abortControllersRef = useRef<AbortController[]>([]);
  const activeExecutionRunIdRef = useRef<string | null>(null);

  const candidates = useMemo(
    () =>
      buildCompareCandidates({
        keys: apiKeys,
        localModels: {
          lmstudioModelId,
          mlxModelId,
          ollamaModelId,
          openaiCompatibleModelId,
          openrouterModelId,
        },
        customEndpoints,
      }),
    [
      apiKeys,
      customEndpoints,
      lmstudioModelId,
      mlxModelId,
      ollamaModelId,
      openaiCompatibleModelId,
      openrouterModelId,
    ],
  );

  const selectedCandidates = useMemo(
    () =>
      selectedIds
        .map((id) => candidateById(candidates, id))
        .filter(Boolean) as CompareCandidate[],
    [candidates, selectedIds],
  );

  const compareCandidates = useMemo(() => {
    if (compareMode === "prompts") {
      return promptCompareCandidates(
        selectedCandidates[0] ?? null,
        promptVariants,
      );
    }
    return selectedCandidates;
  }, [compareMode, promptVariants, selectedCandidates]);

  const probeCandidates = useMemo(() => {
    if (compareMode === "prompts") return selectedCandidates.slice(0, 1);
    return selectedCandidates;
  }, [compareMode, selectedCandidates]);

  const scores = useMemo(
    () =>
      aggregateModelCompareScores(
        scoreRecordsFromCompareHistory(runHistory),
      ).slice(0, 3),
    [runHistory],
  );

  const local = useMemo(
    () =>
      buildCompareLocalConfig({
        lmstudioBaseURL,
        lmstudioModelId,
        mlxBaseURL,
        mlxModelId,
        ollamaBaseURL,
        ollamaModelId,
        openaiCompatibleBaseURL,
        openaiCompatibleModelId,
        openaiCompatibleContextLimit,
        openrouterModelId,
        customEndpoints,
        customEndpointKeys,
      }),
    [
      customEndpoints,
      customEndpointKeys,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openaiCompatibleBaseURL,
      openaiCompatibleContextLimit,
      openaiCompatibleModelId,
      openrouterModelId,
    ],
  );

  useEffect(() => {
    setSelectedIds((current) => normalizeSelection(current, candidates));
  }, [candidates]);

  useEffect(() => {
    if (
      !judgeModelId ||
      !candidates.some((candidate) => candidate.id === judgeModelId)
    ) {
      setJudgeModelId(candidates[0]?.id ?? "");
    }
  }, [candidates, judgeModelId]);

  useEffect(() => {
    let cancelled = false;
    const localHistory = readRunHistory();
    void modelCompareHistoryNative
      .load()
      .then((nativeHistory) => {
        if (cancelled) return;
        if (nativeHistory.length > 0) {
          setRunHistory(nativeHistory);
          writeRunHistory(nativeHistory);
        } else if (localHistory.length > 0) {
          void modelCompareHistoryNative.save(localHistory).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      abortControllersRef.current.forEach((controller) => controller.abort());
    },
    [],
  );

  const persistRun = useCallback((nextRun: ModelCompareRun) => {
    setRunHistory((current) => {
      const next = upsertModelCompareHistory(current, nextRun, Date.now());
      writeRunHistory(next);
      void modelCompareHistoryNative.save(next).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    if (!run || running) return;
    persistRun(run);
  }, [persistRun, run, running]);

  const updateSelection = useCallback((index: number, id: string) => {
    setSelectedIds((current) => {
      const next = current.slice();
      next[index] = id;
      return next.slice(0, MODEL_COMPARE_MAX_MODELS);
    });
  }, []);

  const addModel = useCallback(() => {
    setSelectedIds((current) => {
      if (current.length >= MODEL_COMPARE_MAX_MODELS) return current;
      const next = current.slice();
      for (const candidate of candidates) {
        if (!next.includes(candidate.id)) {
          next.push(candidate.id);
          break;
        }
      }
      return next;
    });
  }, [candidates]);

  const removeModel = useCallback((index: number) => {
    setSelectedIds((current) =>
      current.length <= 2 ? current : current.filter((_, i) => i !== index),
    );
  }, []);

  const stop = useCallback(() => {
    activeExecutionRunIdRef.current = null;
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current = [];
    setRunning(false);
  }, []);

  const patchPane = useCallback(
    (
      runId: string,
      paneId: string,
      patch: Partial<ModelCompareRun["panes"][number]>,
    ) => {
      setRun((current) =>
        current
          ? patchModelComparePaneForRun(current, runId, paneId, patch)
          : current,
      );
    },
    [],
  );

  const executePane = useCallback(
    async (
      runId: string,
      pane: ModelComparePane,
      comparePrompt: string,
      controller: AbortController,
      mode: ModelCompareMode,
    ) => {
      patchPane(runId, pane.id, {
        status: "running",
        response: "",
        error: null,
        metrics: null,
      });
      try {
        const result = await runModelComparePane({
          prompt: pane.candidate.prompt ?? comparePrompt,
          mode,
          modelId: pane.candidate.modelId ?? pane.candidate.id,
          keys: apiKeys,
          local,
          agentContext: {
            activeCwd,
            workspaceRoot,
            // Intentionally omit terminal scrollback from compare panes: it can
            // contain private or irrelevant transient output, while Agent
            // Compare is scoped to read-only workspace inspection.
            terminalContext: null,
          },
          abortSignal: controller.signal,
          onDelta: (delta) => {
            setRun((current) =>
              current
                ? appendModelComparePaneDeltaForRun(
                    current,
                    runId,
                    pane.id,
                    delta,
                  )
                : current,
            );
          },
        });
        patchPane(runId, pane.id, {
          status: "completed",
          response: result.response,
          metrics: result.metrics,
          error: null,
        });
      } catch (error) {
        const aborted = controller.signal.aborted;
        patchPane(runId, pane.id, {
          status: aborted ? "stopped" : "failed",
          error: aborted ? "Stopped" : modelCompareErrorMessage(error),
        });
      }
    },
    [activeCwd, apiKeys, local, patchPane, workspaceRoot],
  );

  const start = useCallback(async () => {
    const comparePrompt = prompt.trim();
    if (compareMode !== "prompts" && !comparePrompt) {
      toast.error("Enter a prompt to compare.");
      return;
    }
    if (compareMode === "research") {
      toast.error(
        "Deep Research compare is deferred until the standalone Deep Research feature ships.",
      );
      return;
    }
    if (compareCandidates.length < 2) {
      toast.error(
        compareMode === "prompts"
          ? "Add at least two prompt variants."
          : "Select at least two configured models.",
      );
      return;
    }

    stop();
    const nextRun = createModelCompareRun({
      id: makeRunId(),
      prompt:
        compareMode === "prompts" ? "Prompt variant comparison" : comparePrompt,
      mode: compareMode,
      candidates: compareCandidates,
      blind,
      now: Date.now(),
    });
    setRun(nextRun);
    activeExecutionRunIdRef.current = nextRun.id;
    setRunning(true);

    const controllers = nextRun.panes.map(() => new AbortController());
    abortControllersRef.current = controllers;

    try {
      if (parallel) {
        await Promise.all(
          nextRun.panes.map((pane, index) =>
            executePane(
              nextRun.id,
              pane,
              comparePrompt,
              controllers[index],
              nextRun.mode,
            ),
          ),
        );
      } else {
        for (let index = 0; index < nextRun.panes.length; index += 1) {
          if (controllers[index]?.signal.aborted) break;
          await executePane(
            nextRun.id,
            nextRun.panes[index],
            comparePrompt,
            controllers[index],
            nextRun.mode,
          );
        }
      }
    } finally {
      if (activeExecutionRunIdRef.current === nextRun.id) {
        activeExecutionRunIdRef.current = null;
        abortControllersRef.current = [];
        setRunning(false);
      }
    }
  }, [
    blind,
    compareCandidates,
    compareMode,
    executePane,
    parallel,
    prompt,
    stop,
  ]);

  const rerunPane = useCallback(
    async (paneId: string) => {
      if (!run || run.vote || running) return;
      const pane = run.panes.find((item) => item.id === paneId);
      if (!pane) return;
      const controller = new AbortController();
      activeExecutionRunIdRef.current = run.id;
      abortControllersRef.current = [controller];
      setRunning(true);
      try {
        await executePane(run.id, pane, run.prompt, controller, run.mode);
      } finally {
        if (activeExecutionRunIdRef.current === run.id) {
          activeExecutionRunIdRef.current = null;
          abortControllersRef.current = [];
          setRunning(false);
        }
      }
    },
    [executePane, run, running],
  );

  const probeSelected = useCallback(async () => {
    if (
      probeCandidates.length < 1 ||
      (compareMode === "models" && probeCandidates.length < 2)
    ) {
      toast.error("Select configured models to probe.");
      return;
    }
    setProbing(true);
    setProbeResults((current) => {
      const next = { ...current };
      for (const candidate of probeCandidates) {
        next[candidate.id] = { status: "checking" };
      }
      return next;
    });

    try {
      const results = await Promise.all(
        probeCandidates.map(async (candidate) => {
          const result = await probeModelCompareModel({
            modelId: candidate.modelId ?? candidate.id,
            keys: apiKeys,
            local,
          });
          setProbeResults((current) => ({
            ...current,
            [candidate.id]: probeStateFromResult(result),
          }));
          return result;
        }),
      );
      const failed = results.filter((result) => result.status === "failed");
      if (failed.length > 0) {
        toast.error(
          `${failed.length} model probe${failed.length === 1 ? "" : "s"} failed.`,
        );
      } else {
        toast.success("All selected models responded.");
      }
    } finally {
      setProbing(false);
    }
  }, [apiKeys, compareMode, local, probeCandidates]);

  const openHistoryEntry = useCallback(
    (entry: ModelCompareHistoryEntry) => {
      stop();
      setRun(entry.run);
      setPrompt(
        entry.run.mode === "prompts" ? SAMPLE_PROMPT : entry.run.prompt,
      );
      setPromptVariants(promptVariantsFromRun(entry.run));
      setCompareMode(entry.run.mode ?? "models");
      setBlind(entry.run.blind);
      setSelectedIds(selectionIdsFromRun(entry.run, candidates));
    },
    [candidates, stop],
  );

  const clearHistory = useCallback(() => {
    if (!shouldClearModelCompareHistory()) return;
    setRunHistory([]);
    writeRunHistory([]);
    void modelCompareHistoryNative.clear().catch(() => {});
  }, []);

  const copyAll = useCallback(async () => {
    if (!run) return;
    try {
      await copyText(
        buildCompareArtifactMarkdown(
          run.revealed ? run : revealModelCompareRun(run),
        ),
      );
      toast.success("Compare copied.");
    } catch (error) {
      toast.error(modelCompareErrorMessage(error));
    }
  }, [run]);

  const copyPrompt = useCallback(async () => {
    const text =
      compareMode === "prompts"
        ? promptVariants
            .map((variant, index) => ({ variant: variant.trim(), index }))
            .filter(({ variant }) => variant.length > 0)
            .map(
              ({ variant, index }) =>
                `Prompt ${String.fromCharCode(65 + index)}\n${variant}`,
            )
            .join("\n\n")
        : prompt.trim();
    if (!text) return;
    try {
      await copyText(text);
      toast.success("Prompt copied.");
    } catch (error) {
      toast.error(modelCompareErrorMessage(error));
    }
  }, [compareMode, prompt, promptVariants]);

  const copyPromptVariant = useCallback(async (variant: string) => {
    const text = variant.trim();
    if (!text) return;
    try {
      await copyText(text);
      toast.success("Prompt variant copied.");
    } catch (error) {
      toast.error(modelCompareErrorMessage(error));
    }
  }, []);

  const copyWinner = useCallback(async () => {
    if (!run) return;
    const text = run.evaluation
      ? formatModelCompareEvaluationWinner(run)
      : winnerLabel(run);
    if (!text || text === "Not voted" || text === "Not judged") return;
    try {
      await copyText(text);
      toast.success("Winner copied.");
    } catch (error) {
      toast.error(modelCompareErrorMessage(error));
    }
  }, [run]);

  const copyPane = useCallback(async (pane: ModelComparePane) => {
    try {
      await copyText(pane.response);
      toast.success("Response copied.");
    } catch (error) {
      toast.error(modelCompareErrorMessage(error));
    }
  }, []);

  const judgeRun = useCallback(async () => {
    const currentRun = run;
    if (
      !currentRun ||
      !modelCompareRunCanJudge(currentRun, running) ||
      !judgeModelId
    )
      return;
    const rubric = judgeRubric.trim() || DEFAULT_JUDGE_RUBRIC;
    setJudging(true);
    try {
      const result = await runModelComparePane({
        prompt: buildModelCompareJudgePrompt(currentRun, rubric),
        modelId: judgeModelId,
        keys: apiKeys,
        local,
      });
      const evaluation = parseModelCompareJudgeResult(
        result.response,
        currentRun,
        Date.now(),
        judgeModelId,
        rubric,
      );
      setRun(applyModelCompareEvaluation(currentRun, evaluation));
      toast.success("Judge evaluation complete.");
    } catch (error) {
      toast.error(modelCompareErrorMessage(error));
    } finally {
      setJudging(false);
    }
  }, [apiKeys, judgeModelId, judgeRubric, local, run, running]);

  const reveal = useCallback(() => {
    if (running) return;
    setRun((current) => (current ? revealModelCompareRun(current) : current));
  }, [running]);

  const vote = useCallback(
    (paneId: string | "tie") => {
      if (running) return;
      setRun((current) => {
        if (!current || !modelCompareRunCanVote(current, false)) return current;
        return voteModelCompareRun(
          current,
          paneId === "tie" ? { kind: "tie" } : { kind: "pane", paneId },
          Date.now(),
        );
      });
    },
    [running],
  );

  const saveArtifact = useCallback(async () => {
    if (!run || running) return;
    setSaving(true);
    try {
      const artifact = await saveModelCompareArtifact(run, artifactsNative);
      onOpenArtifactWorkspace?.(
        artifact.summary.conversationId,
        artifact.summary.slug,
      );
      toast.success("Compare artifact saved.");
    } catch (error) {
      toast.error(modelCompareErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [onOpenArtifactWorkspace, run, running]);

  const busy = running || probing || judging;
  const unsupportedMode = compareMode === "research";
  const hasRunnablePrompt =
    compareMode === "prompts"
      ? promptVariants.filter((variant) => variant.trim().length > 0).length >=
        2
      : prompt.trim().length > 0;
  const canStart =
    compareCandidates.length >= 2 &&
    hasRunnablePrompt &&
    !busy &&
    !unsupportedMode;
  const canVote = modelCompareRunCanVote(run, running);
  const canTie = modelCompareRunCanTie(run, running);
  const canJudge = modelCompareRunCanJudge(run, running);
  const hasDuplicateSelection =
    (compareMode === "models" || compareMode === "agent") &&
    new Set(selectedIds).size !== selectedIds.length;

  return (
    <aside
      aria-label="Model compare"
      className="flex h-full min-h-0 flex-col bg-card/80 text-foreground"
    >
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <HugeiconsIcon
                aria-hidden="true"
                focusable="false"
                icon={GitCompareIcon}
                size={16}
                strokeWidth={2}
              />
              <span>Model Compare</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Blind 2-4 models with a tool-free default.
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            SOTA
          </Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ModelCompareSetupSections
          compareMode={compareMode}
          setCompareMode={setCompareMode}
          unsupportedMode={unsupportedMode}
          prompt={prompt}
          setPrompt={setPrompt}
          promptVariants={promptVariants}
          setPromptVariants={setPromptVariants}
          copyPrompt={copyPrompt}
          copyPromptVariant={copyPromptVariant}
          candidates={candidates}
          selectedIds={selectedIds}
          selectedCandidates={selectedCandidates}
          updateSelection={updateSelection}
          removeModel={removeModel}
          addModel={addModel}
          probeResults={probeResults}
          hasDuplicateSelection={hasDuplicateSelection}
          blind={blind}
          setBlind={setBlind}
          parallel={parallel}
          setParallel={setParallel}
          canStart={canStart}
          running={running}
          start={start}
          probeCandidateCount={probeCandidates.length}
          busy={busy}
          probing={probing}
          probeSelected={probeSelected}
          stop={stop}
          run={run}
          copyAll={copyAll}
          copyWinner={copyWinner}
          saving={saving}
          saveArtifact={saveArtifact}
          canJudge={canJudge}
          judgeModelId={judgeModelId}
          setJudgeModelId={setJudgeModelId}
          judging={judging}
          judgeRun={judgeRun}
          judgeRubric={judgeRubric}
          setJudgeRubric={setJudgeRubric}
        />

        <ModelCompareResultsSection
          run={run}
          running={running}
          canVote={canVote}
          canTie={canTie}
          onReveal={reveal}
          onRerunPane={rerunPane}
          onCopyPane={copyPane}
          onVote={vote}
        />

        <ModelCompareScoreboard scores={scores} />

        <ModelCompareHistorySection
          runHistory={runHistory}
          onClearHistory={clearHistory}
          onOpenHistoryEntry={openHistoryEntry}
        />
      </div>
    </aside>
  );
}
