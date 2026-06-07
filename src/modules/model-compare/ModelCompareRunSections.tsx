import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type {
  ModelComparePane,
  ModelCompareRun,
  ModelCompareScore,
} from "./lib/modelCompare";
import {
  type ModelCompareHistoryEntry,
  modelCompareHistoryTitle,
} from "./lib/modelCompareHistory";
import {
  formatMetricCost,
  formatMetricDuration,
  winnerLabel,
} from "./ModelComparePanelUtils";

export function ModelCompareResultsSection({
  run,
  running,
  canVote,
  canTie,
  onReveal,
  onRerunPane,
  onCopyPane,
  onVote,
}: {
  run: ModelCompareRun | null;
  running: boolean;
  canVote: boolean;
  canTie: boolean;
  onReveal: () => void;
  onRerunPane: (paneId: string) => void | Promise<void>;
  onCopyPane: (pane: ModelComparePane) => void | Promise<void>;
  onVote: (paneId: string | "tie") => void;
}) {
  if (!run) return null;

  return (
    <section className="mt-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Results
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={run.revealed || running}
            onClick={onReveal}
          >
            Reveal
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {run.panes.map((pane) => {
          const isWinner =
            run.vote?.kind === "pane" && run.vote.paneId === pane.id;
          return (
            <article
              key={pane.id}
              className={cn(
                "rounded-xl border bg-background/45 p-2.5",
                isWinner ? "border-primary/60" : "border-border/60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    {pane.status === "running" ? (
                      <Spinner className="size-3" />
                    ) : null}
                    <span className="truncate">{pane.visibleLabel}</span>
                    {isWinner ? (
                      <HugeiconsIcon
                        icon={StarIcon}
                        size={13}
                        strokeWidth={2}
                      />
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {pane.status} ·{" "}
                    {formatMetricDuration(pane.metrics?.latencyMs)} ·{" "}
                    {pane.metrics ? pane.metrics.outputTokens : 0} out ·{" "}
                    {formatMetricCost(pane.metrics?.costUsd)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={!!run.vote || running || pane.status === "idle"}
                    onClick={() => void onRerunPane(pane.id)}
                  >
                    <HugeiconsIcon
                      data-icon="inline-start"
                      icon={RefreshIcon}
                      strokeWidth={2}
                    />
                    Rerun
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={!pane.response}
                    onClick={() => void onCopyPane(pane)}
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
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={!canVote || pane.status !== "completed"}
                    onClick={() => onVote(pane.id)}
                  >
                    <HugeiconsIcon
                      data-icon="inline-start"
                      icon={CheckmarkCircle02Icon}
                      strokeWidth={2}
                    />
                    Vote
                  </Button>
                </div>
              </div>
              <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-card/70 p-2 text-[12px] leading-relaxed text-foreground/90 selectable-text">
                {pane.error ? (
                  <span className="text-destructive">{pane.error}</span>
                ) : (
                  pane.response || "Waiting for response…"
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/40 px-2.5 py-2">
        <span className="truncate text-[11px] text-muted-foreground">
          Winner:{" "}
          <span className="font-medium text-foreground">
            {winnerLabel(run)}
          </span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          disabled={!canTie}
          onClick={() => onVote("tie")}
        >
          Tie
        </Button>
      </div>
    </section>
  );
}

export function ModelCompareScoreboard({
  scores,
}: {
  scores: ModelCompareScore[];
}) {
  if (scores.length === 0) return null;

  return (
    <section className="mt-3 rounded-xl border border-border/60 bg-background/40 p-2.5">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Scoreboard
      </div>
      <div className="flex flex-col gap-1.5">
        {scores.map((score) => (
          <div
            key={score.model}
            className="flex items-center justify-between gap-2 text-[11px]"
          >
            <span className="truncate">{score.model}</span>
            <span className="shrink-0 text-muted-foreground">
              {Math.round(score.winRate * 100)}% · {score.wins}W/{score.losses}
              L/
              {score.ties}T
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ModelCompareHistorySection({
  runHistory,
  onClearHistory,
  onOpenHistoryEntry,
}: {
  runHistory: ModelCompareHistoryEntry[];
  onClearHistory: () => void;
  onOpenHistoryEntry: (entry: ModelCompareHistoryEntry) => void;
}) {
  return (
    <section className="mt-3 rounded-xl border border-border/60 bg-background/40 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          History
        </span>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {runHistory.length}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={runHistory.length === 0}
            onClick={onClearHistory}
          >
            <HugeiconsIcon
              data-icon="inline-start"
              icon={Delete02Icon}
              strokeWidth={2}
            />
            Clear
          </Button>
        </div>
      </div>
      {runHistory.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Completed comparisons appear here for quick reopening.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {runHistory.slice(0, 5).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-muted/70"
              onClick={() => onOpenHistoryEntry(entry)}
            >
              <span className="min-w-0 truncate">
                {modelCompareHistoryTitle(entry)}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <HugeiconsIcon icon={Clock01Icon} size={12} strokeWidth={2} />
                {new Date(entry.savedAt).toLocaleDateString(undefined, {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
