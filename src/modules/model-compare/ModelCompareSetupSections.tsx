import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import ShuffleIcon from "@hugeicons/core-free-icons/ShuffleIcon";
import SquareArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/SquareArrowDataTransferHorizontalIcon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Dispatch, SetStateAction } from "react";
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

type ModelCompareSetupSectionsProps = {
  compareMode: ModelCompareMode;
  setCompareMode: (value: ModelCompareMode) => void;
  unsupportedMode: boolean;
  prompt: string;
  setPrompt: (value: string) => void;
  promptVariants: string[];
  setPromptVariants: Dispatch<SetStateAction<string[]>>;
  copyPrompt: () => void | Promise<void>;
  copyPromptVariant: (variant: string) => void | Promise<void>;
  candidates: CompareCandidate[];
  selectedIds: string[];
  selectedCandidates: CompareCandidate[];
  updateSelection: (index: number, value: string) => void;
  removeModel: (index: number) => void;
  addModel: () => void;
  probeResults: Record<string, ProbeUiState>;
  hasDuplicateSelection: boolean;
  blind: boolean;
  setBlind: (value: boolean) => void;
  parallel: boolean;
  setParallel: (value: boolean) => void;
  canStart: boolean;
  running: boolean;
  start: () => void | Promise<void>;
  probeCandidateCount: number;
  busy: boolean;
  probing: boolean;
  probeSelected: () => void | Promise<void>;
  stop: () => void;
  run: ModelCompareRun | null;
  copyAll: () => void | Promise<void>;
  copyWinner: () => void | Promise<void>;
  saving: boolean;
  saveArtifact: () => void | Promise<void>;
  canJudge: boolean;
  judgeModelId: string;
  setJudgeModelId: (value: string) => void;
  judging: boolean;
  judgeRun: () => void | Promise<void>;
  judgeRubric: string;
  setJudgeRubric: (value: string) => void;
};

export function ModelCompareSetupSections({
  compareMode,
  setCompareMode,
  unsupportedMode,
  prompt,
  setPrompt,
  promptVariants,
  setPromptVariants,
  copyPrompt,
  copyPromptVariant,
  candidates,
  selectedIds,
  selectedCandidates,
  updateSelection,
  removeModel,
  addModel,
  probeResults,
  hasDuplicateSelection,
  blind,
  setBlind,
  parallel,
  setParallel,
  canStart,
  running,
  start,
  probeCandidateCount,
  busy,
  probing,
  probeSelected,
  stop,
  run,
  copyAll,
  copyWinner,
  saving,
  saveArtifact,
  canJudge,
  judgeModelId,
  setJudgeModelId,
  judging,
  judgeRun,
  judgeRubric,
  setJudgeRubric,
}: ModelCompareSetupSectionsProps) {
  return (
    <>
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
            Deep Research comparisons stay gated so compare never grants
            research capability accidentally.
          </p>
        ) : null}
      </section>

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
                  ? promptVariants.every(
                      (variant) => variant.trim().length === 0,
                    )
                  : prompt.trim().length === 0
              }
              onClick={() => void copyPrompt()}
            >
              <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={2} />
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
                  <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={2} />
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
                    icon={Cancel01Icon}
                    size={14}
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
                    aria-hidden="true"
                    focusable="false"
                    icon={Cancel01Icon}
                    size={14}
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

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 text-[12px]"
          disabled={!canStart || hasDuplicateSelection}
          onClick={() => void start()}
        >
          {running ? (
            <Spinner />
          ) : (
            <HugeiconsIcon
              aria-hidden="true"
              focusable="false"
              icon={SquareArrowDataTransferHorizontalIcon}
              size={14}
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
            <Spinner />
          ) : (
            <HugeiconsIcon
              aria-hidden="true"
              focusable="false"
              icon={ZapIcon}
              size={13}
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
            aria-hidden="true"
            focusable="false"
            icon={Copy01Icon}
            size={13}
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
            aria-hidden="true"
            focusable="false"
            icon={StarIcon}
            size={13}
            strokeWidth={2}
          />
          Copy winner
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={!run || saving || running}
          onClick={() => void saveArtifact()}
        >
          {saving ? (
            <Spinner />
          ) : (
            <HugeiconsIcon
              aria-hidden="true"
              focusable="false"
              icon={Copy01Icon}
              size={13}
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
            {judging ? <Spinner /> : "Run judge"}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Judge uses only saved compare responses and your rubric; tools and
          fresh research stay off by default.
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
    </>
  );
}
