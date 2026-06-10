import { Panel } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import type { WorkflowRunHistoryEntry } from "../lib/schema";

export function WorkflowDiffPanel({
  entries,
  leftIndex,
  rightIndex,
  onClose,
}: {
  entries: WorkflowRunHistoryEntry[];
  leftIndex: number;
  rightIndex: number;
  onClose: () => void;
}) {
  const left = entries[leftIndex];
  const right = entries[rightIndex];

  if (!left || !right) {
    return null;
  }

  return (
    <Panel
      position="top-right"
      className="z-50 m-2 flex max-h-[80vh] w-[420px] flex-col rounded-lg border border-border/60 bg-card/95 text-card-foreground shadow-xl backdrop-blur"
    >
      <div className="flex shrink-0 items-center justify-between border-border/40 border-b p-3">
        <div className="font-medium text-sm">Run Diff</div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Summary comparison */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded border border-border/40 bg-muted/20 p-2">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
              Run {leftIndex + 1}
            </div>
            <div className="mt-1 text-xs">{left.status}</div>
            <div className="text-muted-foreground text-[10px]">
              {left.completedCount}/{left.nodeCount} completed
              {left.failedCount > 0 ? ` · ${left.failedCount} failed` : ""}
            </div>
            {left.startedAt && (
              <div className="text-muted-foreground text-[10px]">
                {new Date(left.startedAt).toLocaleTimeString()}
              </div>
            )}
          </div>
          <div className="rounded border border-border/40 bg-muted/20 p-2">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
              Run {rightIndex + 1}
            </div>
            <div className="mt-1 text-xs">{right.status}</div>
            <div className="text-muted-foreground text-[10px]">
              {right.completedCount}/{right.nodeCount} completed
              {right.failedCount > 0 ? ` · ${right.failedCount} failed` : ""}
            </div>
            {right.startedAt && (
              <div className="text-muted-foreground text-[10px]">
                {new Date(right.startedAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        {/* Per-node comparison */}
        <div className="text-muted-foreground text-[10px] uppercase tracking-wide mb-2">
          Node comparison
        </div>
        <NodeDiffTable left={left} right={right} />
      </div>
    </Panel>
  );
}

function NodeDiffTable({
  left,
  right,
}: {
  left: WorkflowRunHistoryEntry;
  right: WorkflowRunHistoryEntry;
}) {
  const leftSnaps = left.nodeSnapshots ?? [];
  const rightSnaps = right.nodeSnapshots ?? [];
  const allNodeIds = new Set<string>();
  for (const s of leftSnaps) allNodeIds.add(s.nodeId);
  for (const s of rightSnaps) allNodeIds.add(s.nodeId);

  const rows = Array.from(allNodeIds).map((nodeId) => {
    const leftSnap = leftSnaps.find((s) => s.nodeId === nodeId);
    const rightSnap = rightSnaps.find((s) => s.nodeId === nodeId);
    return { nodeId, leftSnap, rightSnap };
  });

  // Sort: changed nodes first, then unchanged, then new/removed
  rows.sort((a, b) => {
    const aChanged = a.leftSnap?.status !== a.rightSnap?.status;
    const bChanged = b.leftSnap?.status !== b.rightSnap?.status;
    if (aChanged && !bChanged) return -1;
    if (!aChanged && bChanged) return 1;
    return (a.leftSnap?.title ?? "").localeCompare(b.leftSnap?.title ?? "");
  });

  return (
    <div className="flex flex-col gap-1">
      {rows.map(({ nodeId, leftSnap, rightSnap }) => {
        const statusChanged = leftSnap?.status !== rightSnap?.status;
        const durationChanged =
          leftSnap?.duration !== undefined &&
          rightSnap?.duration !== undefined &&
          leftSnap.duration !== rightSnap.duration;
        const artifactDiff =
          (leftSnap?.artifactCount ?? 0) !== (rightSnap?.artifactCount ?? 0);
        const changed = statusChanged || durationChanged || artifactDiff;

        return (
          <div
            key={nodeId}
            className={`rounded border px-2 py-1.5 text-xs ${
              changed
                ? "border-yellow-500/30 bg-yellow-500/5"
                : "border-border/40 bg-background/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">
                {leftSnap?.title ?? rightSnap?.title ?? nodeId}
              </span>
              {changed && (
                <span className="text-yellow-600 text-[10px]">changed</span>
              )}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center gap-1">
                <StatusDot status={leftSnap?.status} />
                <span className="text-muted-foreground">
                  {leftSnap
                    ? formatSnapshotSummary(leftSnap)
                    : "(not present)"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <StatusDot status={rightSnap?.status} />
                <span className="text-muted-foreground">
                  {rightSnap
                    ? formatSnapshotSummary(rightSnap)
                    : "(not present)"}
                </span>
              </div>
            </div>
            {leftSnap?.error && (
              <div className="mt-1 text-destructive text-[10px] truncate">
                Left: {leftSnap.error}
              </div>
            )}
            {rightSnap?.error && (
              <div className="mt-1 text-destructive text-[10px] truncate">
                Right: {rightSnap.error}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status?: string }) {
  if (!status) {
    return <span className="inline-block h-2 w-2 rounded-full bg-muted" />;
  }
  const color =
    status === "completed"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "running"
          ? "bg-yellow-500"
          : "bg-muted";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function formatSnapshotSummary(snap: {
  status: string;
  duration?: number | null;
  artifactCount: number;
  nodeId?: string;
  title?: string;
  error?: string | null;
}): string {
  const parts: string[] = [snap.status];
  if (snap.duration !== undefined && snap.duration !== null) {
    parts.push(`${snap.duration}ms`);
  }
  if (snap.artifactCount > 0) {
    parts.push(`${snap.artifactCount} artifacts`);
  }
  return parts.join(" · ");
}
