import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import ShuffleIcon from "@hugeicons/core-free-icons/ShuffleIcon";
import SquareArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/SquareArrowDataTransferHorizontalIcon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  use,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type CompareCandidate,
  formatModelCompareEvaluationWinner,
  MODEL_COMPARE_MAX_MODELS,
  type ModelCompareMode,
  type ModelCompareRun,
} from "./lib/modelCompare";
import {
  DEFAULT_PROMPT_VARIANTS,
  formatMetricDuration,
  type ProbeUiState,
  SAMPLE_PROMPT,
} from "./ModelComparePanelUtils";

export type ModelCompareRunPhase = "idle" | "running" | "busy" | "saving";

export type ModelCompareJudgePhase = "idle" | "judging" | "unavailable";

export type ModelCompareSetupState = {
  blind: boolean;
  canStart: boolean;
  compareMode: ModelCompareMode;
  hasDuplicateSelection: boolean;
  judgeModelId: string;
  judgeRubric: string;
  judgePhase: ModelCompareJudgePhase;
  parallel: boolean;
  probeCandidateCount: number;
  probePhase: "idle" | "probing";
  probeResults: Record<string, ProbeUiState>;
  prompt: string;
  promptVariants: string[];
  run: ModelCompareRun | null;
  runPhase: ModelCompareRunPhase;
  selectedCandidates: CompareCandidate[];
  selectedIds: string[];
  unsupportedMode: boolean;
};

export type ModelCompareSetupActions = {
  addModel: () => void;
  copyAll: () => void | Promise<void>;
  copyPrompt: () => void | Promise<void>;
  copyPromptVariant: (variant: string) => void | Promise<void>;
  copyWinner: () => void | Promise<void>;
  judgeRun: () => void | Promise<void>;
  probeSelected: () => void | Promise<void>;
  removeModel: (index: number) => void;
  saveArtifact: () => void | Promise<void>;
  setBlind: (value: boolean) => void;
  setCompareMode: (value: ModelCompareMode) => void;
  setJudgeModelId: (value: string) => void;
  setJudgeRubric: (value: string) => void;
  setParallel: (value: boolean) => void;
  setPrompt: (value: string) => void;
  setPromptVariants: Dispatch<SetStateAction<string[]>>;
  start: () => void | Promise<void>;
  stop: () => void;
  updateSelection: (index: number, value: string) => void;
};

export type ModelCompareSetupMeta = {
  candidates: CompareCandidate[];
};

type ModelCompareSetupContextValue = {
  actions: ModelCompareSetupActions;
  meta: ModelCompareSetupMeta;
  state: ModelCompareSetupState;
};

const ModelCompareSetupContext =
  createContext<ModelCompareSetupContextValue | null>(null);

export function ModelCompareSetupProvider({
  actions,
  children,
  meta,
  state,
}: ModelCompareSetupContextValue & { children: ReactNode }) {
  return (
    <ModelCompareSetupContext.Provider value={{ actions, meta, state }}>
      {children}
    </ModelCompareSetupContext.Provider>
  );
}

function useModelCompareSetup(): ModelCompareSetupContextValue {
  const context = use(ModelCompareSetupContext);
  if (!context) {
    throw new Error(
      "ModelCompareSetupSections must be used within ModelCompareSetupProvider",
    );
  }
  return context;
}

function ModelCompareModeSection() {
  const {
    actions: { setCompareMode },
    state: { compareMode, unsupportedMode },
  } = useModelCompareSetup();

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Mode
        </span>
        <Badge variant="outline" className="text-[10px]">
          {compareMode === "agent"
            ? "read-only tools"
            : unsupportedMode
              ? "explicit later"
              : "tool-free"}
        </Badge>
      </div>
      <Select
        value={compareMode}
        onValueChange={(value) => setCompareMode(value as ModelCompareMode)}
      >
        <SelectTrigger size="sm" className="w-full rounded-lg text-[11px]">
          <SelectValue placeholder="Compare mode" />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectGroup>
            <SelectItem value="models">Models · same prompt</SelectItem>
            <SelectItem value="prompts">Prompts · same model</SelectItem>
            <SelectItem value="agent">Agent mode · read-only</SelectItem>
            <SelectItem value="research">Deep Research · gated</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        Agent Compare uses explicit read-only tools for workspace inspection;
        Deep Research Compare stays deferred until the research feature ships.
      </p>
      {unsupportedMode ? (
        <p className="text-[11px] text-muted-foreground">
          Deep Research comparisons stay gated so compare never grants research
          capability accidentally.
        </p>
      ) : null}
    </section>
  );
}

function ModelComparePromptSection() {
  const {
    actions: { copyPrompt, copyPromptVariant, setPrompt, setPromptVariants },
    state: { compareMode, prompt, promptVariants },
  } = useModelCompareSetup();

  return (
    <section className="mt-3 flex flex-col gap-2 rounded-xl border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Prompt
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={
              compareMode === "prompts"
                ? promptVariants.every((variant) => variant.trim().length === 0)
                : prompt.trim().length === 0
            }
            onClick={() => void copyPrompt()}
          >
            <HugeiconsIcon
              data-icon="inline-start"
              icon={Copy01Icon}
              strokeWidth={2}
            />
            Copy prompt
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              if (compareMode === "prompts") {
                setPromptVariants([...DEFAULT_PROMPT_VARIANTS]);
              } else {
                setPrompt(SAMPLE_PROMPT);
              }
            }}
          >
            Reset
          </Button>
        </div>
      </div>
      <Textarea
        aria-label="Comparison prompt"
        name="comparisonPrompt"
        autoComplete="off"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        className="min-h-24 resize-none rounded-lg bg-card/80 text-[12px] leading-relaxed"
        placeholder="Send the exact same prompt to every model…"
        disabled={compareMode === "prompts"}
      />
      {compareMode === "prompts" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">
            Prompt mode runs each variant on the first selected model.
          </p>
          {promptVariants.map((variant, index) => (
            <div key={index} className="flex items-start gap-1.5">
              <Textarea
                aria-label={`Prompt variant ${index + 1}`}
                value={variant}
                onChange={(event) => {
                  const value = event.target.value;
                  setPromptVariants((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? value : item,
                    ),
                  );
                }}
                className="min-h-20 resize-none rounded-lg bg-card/80 text-[12px] leading-relaxed"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1 h-7 shrink-0 px-2 text-[11px]"
                disabled={variant.trim().length === 0}
                onClick={() => void copyPromptVariant(variant)}
                aria-label="Copy prompt variant"
              >
                <HugeiconsIcon
                  data-icon="inline-start"
                  icon={Copy01Icon}
                  strokeWidth={2}
                />
                Copy
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mt-1 size-7 shrink-0"
                disabled={promptVariants.length <= 2}
                onClick={() =>
                  setPromptVariants((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                aria-label="Remove prompt variant"
              >
                <HugeiconsIcon
                  data-icon="inline-start"
                  icon={Cancel01Icon}
                  strokeWidth={2}
                />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 justify-center text-[11px]"
            disabled={promptVariants.length >= MODEL_COMPARE_MAX_MODELS}
            onClick={() => setPromptVariants((current) => [...current, ""])}
          >
            Add prompt variant
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ModelCompareModelsSection() {
  const {
    actions: { addModel, removeModel, updateSelection },
    meta: { candidates },
    state: {
      hasDuplicateSelection,
      probeResults,
      selectedCandidates,
      selectedIds,
    },
  } = useModelCompareSetup();

  return (
    <section className="mt-3 flex flex-col gap-2 rounded-xl border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Models
        </span>
        <Badge variant="outline" className="text-[10px]">
          {selectedCandidates.length || 0}/4 selected
        </Badge>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
          Add API keys or local model IDs in Settings → Models to compare.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {selectedIds.map((selectedId, index) => (
            <div
              key={`${index}-${selectedId}`}
              className="flex items-center gap-1.5"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
                {String.fromCharCode(65 + index)}
              </span>
              <Select
                value={selectedId}
                onValueChange={(value) => updateSelection(index, value)}
              >
                <SelectTrigger
                  size="sm"
                  className="min-w-0 flex-1 rounded-lg text-[11px]"
                >
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent align="start" className="max-w-80">
                  <SelectGroup>
                    {candidates.map((candidate) => (
                      <SelectItem
                        key={candidate.id}
                        value={candidate.id}
                        disabled={
                          selectedIds.includes(candidate.id) &&
                          candidate.id !== selectedId
                        }
                      >
                        {candidate.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                disabled={selectedIds.length <= 2}
                onClick={() => removeModel(index)}
                aria-label="Remove model"
              >
                <HugeiconsIcon
                  data-icon="inline-start"
                  aria-hidden="true"
                  focusable="false"
                  icon={Cancel01Icon}
                  strokeWidth={2}
                />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 justify-center text-[11px]"
            onClick={addModel}
            disabled={
              selectedIds.length >= MODEL_COMPARE_MAX_MODELS ||
              candidates.length <= selectedIds.length
            }
          >
            Add model
          </Button>
          {selectedCandidates.some(
            (candidate) => probeResults[candidate.id],
          ) ? (
            <div className="rounded-lg bg-card/70 p-2 text-[10px] text-muted-foreground">
              {selectedCandidates.map((candidate) => {
                const result = probeResults[candidate.id];
                if (!result) return null;
                return (
                  <div
                    key={candidate.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{candidate.label}</span>
                    <span
                      className={cn(
                        "shrink-0",
                        result.status === "failed" && "text-destructive",
                        result.status === "ok" && "text-primary",
                      )}
                    >
                      {result.status === "checking"
                        ? "checking…"
                        : result.status === "ok"
                          ? `ok · ${formatMetricDuration(result.latencyMs)}`
                          : (result.error ?? "failed")}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {hasDuplicateSelection ? (
        <p className="text-[11px] text-destructive">
          Each pane needs a unique model.
        </p>
      ) : null}
    </section>
  );
}

function ModelCompareOptionsSection() {
  const {
    actions: { setBlind, setParallel },
    state: { blind, parallel },
  } = useModelCompareSetup();

  return (
    <section className="mt-3 grid grid-cols-2 gap-2">
      <label className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/40 px-2.5 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium">
          <HugeiconsIcon icon={ViewIcon} size={14} strokeWidth={2} />
          Blind
        </span>
        <Switch size="sm" checked={blind} onCheckedChange={setBlind} />
      </label>
      <label className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/40 px-2.5 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium">
          <HugeiconsIcon icon={ShuffleIcon} size={14} strokeWidth={2} />
          Parallel
        </span>
        <Switch size="sm" checked={parallel} onCheckedChange={setParallel} />
      </label>
    </section>
  );
}

function ModelCompareActionGrid() {
  const {
    actions: { copyAll, copyWinner, probeSelected, saveArtifact, start, stop },
    state: {
      canStart,
      hasDuplicateSelection,
      probeCandidateCount,
      probePhase,
      run,
      runPhase,
    },
  } = useModelCompareSetup();

  const running = runPhase === "running";
  const busy = runPhase === "busy" || runPhase === "saving";
  const probing = probePhase === "probing";
  const saving = runPhase === "saving";

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 text-[12px]"
          disabled={!canStart || hasDuplicateSelection}
          onClick={() => void start()}
        >
          {running ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <HugeiconsIcon
              data-icon="inline-start"
              aria-hidden="true"
              focusable="false"
              icon={SquareArrowDataTransferHorizontalIcon}
              strokeWidth={2}
            />
          )}
          {running ? "Running" : "Run compare"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={probeCandidateCount < 1 || busy || hasDuplicateSelection}
          onClick={() => void probeSelected()}
        >
          {probing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <HugeiconsIcon
              data-icon="inline-start"
              aria-hidden="true"
              focusable="false"
              icon={ZapIcon}
              strokeWidth={2}
            />
          )}
          Probe
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={!running}
          onClick={stop}
        >
          Stop
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={!run}
          onClick={() => void copyAll()}
        >
          <HugeiconsIcon
            data-icon="inline-start"
            aria-hidden="true"
            focusable="false"
            icon={Copy01Icon}
            strokeWidth={2}
          />
          Copy all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={!run || (!run.vote && !run.evaluation)}
          onClick={() => void copyWinner()}
        >
          <HugeiconsIcon
            data-icon="inline-start"
            aria-hidden="true"
            focusable="false"
            icon={StarIcon}
            strokeWidth={2}
          />
          Copy winner
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={!run || saving || busy}
          onClick={() => void saveArtifact()}
        >
          {saving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <HugeiconsIcon
              data-icon="inline-start"
              aria-hidden="true"
              focusable="false"
              icon={Copy01Icon}
              strokeWidth={2}
            />
          )}
          Save artifact
        </Button>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Probe sends exactly OK to selected models without tools, so failures are
        easy to spot before a run.
      </p>
    </>
  );
}

function ModelCompareJudgeSection() {
  const {
    actions: { judgeRun, setJudgeModelId, setJudgeRubric },
    meta: { candidates },
    state: { judgeModelId, judgePhase, judgeRubric, run, runPhase },
  } = useModelCompareSetup();

  const busy = runPhase === "busy" || runPhase === "saving";
  const canJudge = judgePhase === "idle";
  const judging = judgePhase === "judging";

  return (
    <section className="mt-3 flex flex-col gap-2 rounded-xl border border-border/60 bg-background/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <HugeiconsIcon icon={BrainIcon} size={13} strokeWidth={2} />
          Judge
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={!canJudge || !judgeModelId || busy}
          onClick={() => void judgeRun()}
        >
          {judging ? <Spinner data-icon="inline-start" /> : "Run judge"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Judge uses only saved compare responses and your rubric; tools and fresh
        research stay off by default.
      </p>
      <Select value={judgeModelId} onValueChange={setJudgeModelId}>
        <SelectTrigger size="sm" className="w-full rounded-lg text-[11px]">
          <SelectValue placeholder="Judge model" />
        </SelectTrigger>
        <SelectContent align="start" className="max-w-80">
          <SelectGroup>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Textarea
        aria-label="Judge rubric"
        value={judgeRubric}
        onChange={(event) => setJudgeRubric(event.target.value)}
        className="min-h-16 resize-none rounded-lg bg-card/80 text-[11px] leading-relaxed"
      />
      {run?.evaluation ? (
        <div className="rounded-lg bg-card/70 p-2 text-[11px] text-muted-foreground">
          <div className="font-medium text-foreground">
            {run.evaluation.summary}
          </div>
          <div className="mt-1">
            Winner: {formatModelCompareEvaluationWinner(run)}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ModelCompareSetupSectionsRoot() {
  return (
    <>
      <ModelCompareSetupSections.Mode />
      <ModelCompareSetupSections.Prompt />
      <ModelCompareSetupSections.Models />
      <ModelCompareSetupSections.Options />
      <ModelCompareSetupSections.Actions />
      <ModelCompareSetupSections.Judge />
    </>
  );
}

export const ModelCompareSetupSections = Object.assign(
  ModelCompareSetupSectionsRoot,
  {
    Actions: ModelCompareActionGrid,
    Judge: ModelCompareJudgeSection,
    Mode: ModelCompareModeSection,
    Models: ModelCompareModelsSection,
    Options: ModelCompareOptionsSection,
    Prompt: ModelComparePromptSection,
  },
);
